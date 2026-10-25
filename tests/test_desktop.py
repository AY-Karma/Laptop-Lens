import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from desktop import DesktopApi, SingleInstance, serialize_export, request_control_access
from telemetry import run_hidden


class DesktopTests(unittest.TestCase):
    @patch('desktop.request_control_access')
    @patch('desktop.is_admin', return_value=False)
    def test_control_access_is_requested_only_on_manual_enable(self, admin, request):
        api = DesktopApi(Mock())
        api._window = Mock()
        request.assert_not_called()
        request.return_value = False
        self.assertFalse(api.enable_device_controls()['restarting'])
        api._window.destroy.assert_not_called()
        request.return_value = True
        self.assertTrue(api.enable_device_controls()['restarting'])
        api._window.destroy.assert_called_once_with()
        request.reset_mock()
        admin.return_value = True
        self.assertFalse(api.enable_device_controls()['restarting'])
        request.assert_not_called()

    @patch('desktop.ctypes.WinDLL')
    def test_elevation_relaunch_uses_fixed_app_and_parent_wait(self, dll):
        shell = dll.return_value
        shell.ShellExecuteW.return_value = 42
        self.assertTrue(request_control_access())
        args = shell.ShellExecuteW.call_args.args
        self.assertEqual(args[1], 'runas')
        self.assertNotIn('--startup-elevation-attempted', args[3])
        self.assertIn(f'--wait-for-exit {os.getpid()}', args[3])
        shell.ShellExecuteW.return_value = 5
        self.assertFalse(request_control_access())

    def test_native_report_serialization(self):
        snapshot = {'history': [], 'app': 'Laptop Lens'}
        content, filename = serialize_export(snapshot, 'json')
        self.assertEqual(json.loads(content), snapshot)
        self.assertTrue(filename.endswith('.json'))
        content, _ = serialize_export(snapshot, 'csv')
        self.assertTrue(content.startswith('timestamp,cpu,'))
        with self.assertRaises(ValueError):
            serialize_export(snapshot, '../anything')

    def test_cancel_native_save_does_not_write(self):
        monitor = Mock()
        monitor.snapshot.return_value = {'history': []}
        api = DesktopApi(monitor)
        api._window = Mock()
        api._window.create_file_dialog.return_value = None
        self.assertTrue(api.save_report('json')['cancelled'])

    def test_native_save_uses_selected_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'chosen-report.json'
            monitor = Mock()
            monitor.snapshot.return_value = {'history': [], 'app': 'Laptop Lens'}
            api = DesktopApi(monitor)
            api._window = Mock()
            api._window.create_file_dialog.return_value = (str(destination),)
            self.assertTrue(api.save_report('json')['saved'])
            self.assertEqual(json.loads(destination.read_text())['app'], 'Laptop Lens')

    def test_windows_single_instance_mutex(self):
        name = f'Local\\LaptopLens.Test.{os.getpid()}'
        first, second = SingleInstance(name), SingleInstance(name)
        try:
            self.assertFalse(first.exists)
            self.assertTrue(second.exists)
        finally:
            first.close()
            second.close()

    def test_helper_can_be_cancelled_on_close(self):
        import sys
        stop = threading.Event()
        stop.set()
        with self.assertRaises(TimeoutError):
            run_hidden([sys.executable, '-c', 'import time; time.sleep(10)'], stop=stop)


if __name__ == '__main__':
    unittest.main()
