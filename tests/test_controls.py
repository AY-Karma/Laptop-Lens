import json
import subprocess
import time
import unittest
from unittest.mock import Mock, call, patch

from legion_controls import LegionControls, EnergyDriver, battery_commands, decode_battery, decode_usb
from system_actions import DeviceDetails, open_destination


class RoutingTests(unittest.TestCase):
    @patch('system_actions.os.startfile')
    def test_windows_update_uses_exact_settings_route(self, launch):
        self.assertTrue(open_destination('updates')['opened'])
        launch.assert_called_once_with('ms-settings:windowsupdate')

    @patch('system_actions.os.startfile')
    def test_unknown_or_arbitrary_targets_are_rejected(self, launch):
        for value in ('powershell.exe', 'ms-settings:windowsupdate', 'file:///C:/', {}, None):
            self.assertFalse(open_destination(value)['opened'])
        launch.assert_not_called()

    @patch('system_actions.os.startfile', side_effect=OSError('Unavailable'))
    def test_settings_failure_returns_explicit_fallback(self, launch):
        result = open_destination('camera')
        self.assertFalse(result['opened'])
        self.assertEqual(result['fallback'], 'settings')

    @patch('system_actions.subprocess.Popen')
    @patch('system_actions.run_hidden')
    def test_vantage_uses_discovered_aumid_as_one_argument(self, query, launch):
        app_id = 'E046963F.LenovoCompanion_k1h2ywk1493x8!App'
        query.return_value = subprocess.CompletedProcess([], 0, app_id, '')
        self.assertTrue(open_destination('vantage')['opened'])
        self.assertEqual(launch.call_args.args[0][1], 'shell:AppsFolder\\' + app_id)
        self.assertEqual(len(launch.call_args.args[0]), 2)

    @patch('system_actions.run_hidden')
    def test_missing_vantage_does_not_install_silently(self, query):
        query.return_value = subprocess.CompletedProcess([], 1, '', 'Missing')
        result = open_destination('vantage')
        self.assertFalse(result['opened'])
        self.assertEqual(result['fallback'], 'vantage_store')


class DeviceDetailsTests(unittest.TestCase):
    def test_ids_are_hidden_until_reveal_and_copy_is_explicit(self):
        details = DeviceDetails()
        details._cached = {'deviceName': 'Test laptop', 'serialNumber': 'TEST-SERIAL',
                           'deviceId': 'TEST-ID', 'productId': 'TEST-PRODUCT'}
        details._at = time.monotonic()
        self.assertEqual(details.read()['serialNumber'], 'Hidden')
        self.assertEqual(details.read(True)['serialNumber'], 'TEST-SERIAL')
        self.assertIn('TEST-SERIAL', details.copy_text('all'))
        self.assertEqual(details.read()['serialNumber'], 'Hidden')
        with self.assertRaises(ValueError):
            details.copy_text('untrustedField')


class ControlTests(unittest.TestCase):
    def test_driver_wire_values_and_mode_precedence(self):
        self.assertEqual(decode_battery(0x00000204), 'rapid')
        self.assertEqual(decode_battery(0x00000200), 'normal')
        self.assertEqual(decode_battery(0x00000020), 'conservation')
        self.assertEqual(decode_battery(0x00000224), 'rapid')
        with self.assertRaises(ValueError):
            decode_battery(0)
        self.assertEqual([decode_usb(v) for v in (0, 0x80, 0x8080)], ['off', 'sleep', 'always'])

    def test_charge_modes_do_not_leave_rapid_and_conservation_enabled(self):
        self.assertEqual(battery_commands('rapid', 'conservation'), [0x08, 0x03])
        self.assertEqual(battery_commands('conservation', 'rapid'), [0x05, 0x07])
        self.assertEqual(battery_commands('conservation', 'normal'), [0x05])
        self.assertEqual(battery_commands('rapid', 'normal'), [0x08])
        self.assertEqual(battery_commands('normal', 'normal'), [])

    @patch('legion_controls.run_hidden')
    def test_invalid_writes_are_rejected_before_any_provider_call(self, query):
        controller = LegionControls()
        for key, value in [('thermal', 255), ('thermal', True), ('always_usb', 'arbitrary'), ('battery_mode', '80%'), ('unknown', 1), ([], 0)]:
            with self.assertRaises(ValueError):
                controller.set(key, value)
        query.assert_not_called()

    @patch('legion_controls.EnergyDriver')
    @patch('legion_controls.is_admin', return_value=False)
    def test_discovery_does_not_issue_write_commands(self, admin, driver_class):
        controller = LegionControls()
        controller._verified_model = True
        driver = driver_class.return_value
        driver.battery.return_value, driver.usb.return_value = 'rapid', 'sleep'
        result = controller.read()
        self.assertTrue(result['controls']['battery_mode']['available'])
        self.assertFalse(result['controls']['thermal']['available'])
        driver.command.assert_not_called()
        driver.close.assert_called_once()

    @patch('legion_controls.EnergyDriver')
    def test_unverified_model_never_opens_driver(self, driver):
        controller = LegionControls()
        controller._verified_model = False
        self.assertIn('error', controller.read())
        driver.assert_not_called()

    @patch('legion_controls.run_hidden')
    @patch('legion_controls.psutil.sensors_battery')
    def test_performance_mode_requires_ac_before_write(self, battery, provider):
        controller = LegionControls()
        controller.read = Mock(return_value={'controls': {'thermal': {'available': True, 'value': 2}}})
        battery.return_value = Mock(power_plugged=False)
        with self.assertRaisesRegex(RuntimeError, 'AC power'):
            controller.set('thermal', 3)
        provider.assert_not_called()

    @patch('legion_controls.time.sleep')
    @patch('legion_controls.EnergyDriver')
    def test_charge_write_requires_verified_readback(self, driver_class, sleep):
        controller = LegionControls()
        before = {'controls': {'battery_mode': {'available': True, 'value': 'rapid'}}}
        # Simulate a partial write: the target mode was not established.
        after = {'controls': {'battery_mode': {'available': True, 'value': 'normal'}}}
        controller.read = Mock(side_effect=[before, after])
        driver = driver_class.return_value
        driver.battery.return_value = 'rapid'
        driver.BATTERY = EnergyDriver.BATTERY
        result = controller.set('battery_mode', 'conservation')
        self.assertFalse(result['success'])
        self.assertIn('partially', result['error'])
        self.assertEqual([c.args[1] for c in driver.command.call_args_list], [0x08, 0x03])
        self.assertEqual(controller.read.call_args_list, [call(force=True), call(force=True)])


if __name__ == '__main__':
    unittest.main()
