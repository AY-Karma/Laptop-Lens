"""Bounded Legion Gen6 controls. No driver installs, raw EC or UEFI writes.

Mappings and provenance: docs/CONTROLS-RESEARCH.md. Reads never invoke setters.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import threading
import time

import psutil

from system_actions import is_admin
from telemetry import run_hidden

GAMEZONE = {
    'thermal': ('IsSupportSmartFan', 'GetSmartFanMode', 'SetSmartFanMode', (1, 2, 3)),
    'overdrive': ('IsSupportOD', 'GetODStatus', 'SetODStatus', (0, 1)),
    'touchpad_lock': ('IsSupportDisableTP', 'GetTPStatus', 'SetTPStatus', (0, 1)),
    'hybrid': ('IsSupportGSync', 'GetGSyncStatus', 'SetGSyncStatus', (0, 1)),
}
MODEL_SCRIPT = r"""$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
$s=Get-CimInstance Win32_ComputerSystem;
if ($s.Manufacturer -ne 'LENOVO' -or $s.Model -ne '82JU') { throw 'This model has not been validated for direct Legion controls.' };
"""


def swap32(value):
    return int.from_bytes(value.to_bytes(4, 'little'), 'big')


def decode_battery(value):
    value = swap32(value)
    if value & (1 << 17):
        return 'rapid' if value & (1 << 26) else 'normal'
    if value & (1 << 29):
        return 'conservation'
    raise ValueError('The charge mode returned an unknown value')


def decode_usb(value):
    value = swap32(value)
    return 'off' if not value & (1 << 31) else 'always' if value & (1 << 23) else 'sleep'


def battery_commands(before, desired):
    if before not in ('normal', 'rapid', 'conservation') or desired not in ('normal', 'rapid', 'conservation'):
        raise ValueError('Unknown charging mode')
    if before == desired:
        return []
    if desired == 'conservation':
        return [0x08, 0x03] if before == 'rapid' else [0x03]
    if desired == 'rapid':
        return [0x05, 0x07] if before == 'conservation' else [0x07]
    return [0x05] if before == 'conservation' else [0x08]


class EnergyDriver:
    """Use an already installed Lenovo driver; only two allowlisted IOCTLs."""
    BATTERY = 0x831020F8
    USB = 0x831020E8

    def __init__(self):
        self._kernel = c.WinDLL('kernel32', use_last_error=True)
        self._kernel.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
        self._kernel.CreateFileW.restype = w.HANDLE
        self._kernel.CloseHandle.argtypes = [w.HANDLE]
        self._kernel.DeviceIoControl.argtypes = [w.HANDLE, w.DWORD, c.c_void_p, w.DWORD, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p]
        self._kernel.DeviceIoControl.restype = w.BOOL
        self._handle = self._kernel.CreateFileW(r'\\.\EnergyDrv', 3, 3, None, 3, 0, None)
        if self._handle == c.c_void_p(-1).value:
            raise c.WinError(c.get_last_error())

    def command(self, ioctl, value, query=False):
        allowed = {self.BATTERY: {0xFF, 0x03, 0x05, 0x07, 0x08}, self.USB: {0x02, 0x0A, 0x0B, 0x12, 0x13}}
        if ioctl not in allowed or value not in allowed[ioctl]:
            raise ValueError('Unknown Lenovo driver command')
        source, target, returned = w.DWORD(value), w.DWORD(), w.DWORD()
        ok = self._kernel.DeviceIoControl(self._handle, ioctl, c.byref(source), 4, c.byref(target), 4, c.byref(returned), None)
        if not ok:
            raise c.WinError(c.get_last_error())
        if query and returned.value != 4:
            raise ValueError('Lenovo driver returned an incomplete reading')
        return target.value

    def battery(self):
        return decode_battery(self.command(self.BATTERY, 0xFF, query=True))

    def usb(self):
        return decode_usb(self.command(self.USB, 0x02, query=True))

    def close(self):
        self._kernel.CloseHandle(self._handle)


class LegionControls:
    def __init__(self):
        self._lock = threading.RLock()
        self._cached = None
        self._at = 0
        self._verified_model = None

    def _model(self):
        if self._verified_model is None:
            result = run_hidden(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', MODEL_SCRIPT], 10)
            self._verified_model = result.returncode == 0
        return self._verified_model

    def read(self, force=False):
        with self._lock:
            if self._cached and not force and time.monotonic() - self._at < 15:
                return self._cached
            result = {'admin': is_admin(), 'updatedAt': time.time(), 'controls': {}, 'sensors': {}}
            if not self._model():
                result['error'] = 'Direct controls are validated only for Legion 82JU. Open Lenovo Vantage for this device.'
                self._cached, self._at = result, time.monotonic()
                return result
            driver = None
            try:
                driver = EnergyDriver()
                for key, getter in (('battery_mode', driver.battery), ('always_usb', driver.usb)):
                    try:
                        result['controls'][key] = {'available': True, 'value': getter(), 'source': 'Lenovo Energy Management driver'}
                    except Exception:
                        result['controls'][key] = {'available': False, 'reason': 'The installed Lenovo driver did not expose a valid reading.'}
            except OSError:
                for key in ('battery_mode', 'always_usb'):
                    result['controls'][key] = {'available': False, 'reason': 'Lenovo Energy Management driver is unavailable or access is denied.'}
            finally:
                if driver:
                    driver.close()
            if not result['admin']:
                for key in GAMEZONE:
                    result['controls'][key] = {'available': False, 'reason': 'Administrator access is required to read this Lenovo control.'}
            else:
                probes = []
                for key, (support, getter, _, _) in GAMEZONE.items():
                    probes.append(f"try {{ $support=Invoke-CimMethod -InputObject $g -MethodName {support}; if ([int]$support.Data -le 0) {{ throw 'Not supported by this firmware or panel.' }}; $v=Invoke-CimMethod -InputObject $g -MethodName {getter}; $r.controls['{key}']=@{{available=$true;value=[int]$v.Data;source='Lenovo GameZone WMI'}} }} catch {{ $r.controls['{key}']=@{{available=$false;reason=$_.Exception.Message}} }}")
                for key, getter in (('cpuTemperature', 'GetCPUTemp'), ('gpuTemperature', 'GetGPUTemp'), ('fan1Rpm', 'GetFan1Speed'), ('fan2Rpm', 'GetFan2Speed')):
                    probes.append(f"try {{ $r.sensors['{key}']=[int](Invoke-CimMethod -InputObject $g -MethodName {getter}).Data }} catch {{}}")
                script = MODEL_SCRIPT + "$g=Get-CimInstance -Namespace root/wmi -ClassName LENOVO_GAMEZONE_DATA | Select-Object -First 1; $r=@{controls=@{};sensors=@{}};" + ';'.join(probes) + '; $r | ConvertTo-Json -Compress -Depth 5'
                try:
                    response = run_hidden(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], 15)
                    if response.returncode:
                        raise RuntimeError('The Lenovo provider denied access or is unavailable.')
                    values = json.loads(response.stdout.lstrip('\ufeff'))
                    for key, state in values['controls'].items():
                        if state.get('available') and state.get('value') not in GAMEZONE[key][3]:
                            state = {'available': False, 'reason': 'The firmware returned an unknown setting value.'}
                        result['controls'][key] = state
                    result['sensors'] = {k: v for k, v in values['sensors'].items()
                                         if isinstance(v, int) and (0 < v < 125 if 'Temperature' in k else 0 <= v <= 12000)}
                except Exception as exc:
                    result['error'] = str(exc)
            self._cached, self._at = result, time.monotonic()
            return result

    def set(self, key, desired):
        with self._lock:
            if not isinstance(key, str):
                raise ValueError('Unknown Lenovo control')
            if key in GAMEZONE:
                if type(desired) is not int or desired not in GAMEZONE[key][3]:
                    raise ValueError('Invalid Lenovo setting value')
            elif key == 'battery_mode':
                if desired not in ('normal', 'conservation', 'rapid'):
                    raise ValueError('Invalid charging mode')
            elif key == 'always_usb':
                if desired not in ('off', 'sleep', 'always'):
                    raise ValueError('Invalid USB power mode')
            else:
                raise ValueError('Unknown Lenovo control')
            state = self.read(force=True)['controls'].get(key, {})
            if not state.get('available'):
                raise RuntimeError(state.get('reason', 'This Lenovo control is unavailable.'))
            if key == 'thermal' and desired == 3:
                battery = psutil.sensors_battery()
                if not battery or not battery.power_plugged:
                    raise RuntimeError('Connect AC power before selecting Performance mode.')
            if state['value'] == desired:
                return {'success': True, 'state': self.read(), 'message': 'The requested setting is already active.'}
            if key in GAMEZONE:
                if not is_admin():
                    raise RuntimeError('Enable Lenovo controls first.')
                support, getter, setter, _ = GAMEZONE[key]
                script = MODEL_SCRIPT + f"$g=Get-CimInstance -Namespace root/wmi -ClassName LENOVO_GAMEZONE_DATA | Select-Object -First 1; if ([int](Invoke-CimMethod -InputObject $g -MethodName {support}).Data -le 0) {{ throw 'Control not supported' }}; $null=Invoke-CimMethod -InputObject $g -MethodName {setter} -Arguments @{{Data=[uint32]{desired}}};"
                response = run_hidden(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], 12)
                if response.returncode:
                    raise RuntimeError('Lenovo rejected the change. Refresh the reading or open Vantage.')
            else:
                driver = EnergyDriver()
                try:
                    if key == 'battery_mode':
                        for command in battery_commands(driver.battery(), desired):
                            driver.command(driver.BATTERY, command)
                    else:
                        commands = {'off': [0x0B, 0x12], 'sleep': [0x0A, 0x12], 'always': [0x0A, 0x13]}[desired]
                        for command in commands:
                            driver.command(driver.USB, command)
                finally:
                    driver.close()
            time.sleep(.2)
            after = self.read(force=True)
            confirmed = after['controls'].get(key, {}).get('value') == desired
            if not confirmed:
                return {'success': False, 'state': after, 'error': 'The change could not be confirmed. Refresh before trying again; it may have partially applied.'}
            return {'success': True, 'state': after, 'message':
                    'Graphics configuration saved. Restart Windows when convenient to apply it; active GPU routing is unchanged until restart.' if key == 'hybrid'
                    else 'Setting applied and verified from the device.'}
