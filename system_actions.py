"""Literal native destinations and on-demand, local device details."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import threading
import time

from telemetry import run_hidden

DESTINATIONS = {
    'task_manager': ('Task Manager', str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'Taskmgr.exe')),
    'updates': ('Windows Update', 'ms-settings:windowsupdate'),
    'optional_updates': ('Optional updates', 'ms-settings:windowsupdate-optionalupdates'),
    'update_history': ('Update history', 'ms-settings:windowsupdate-history'),
    'update_options': ('Update options', 'ms-settings:windowsupdate-options'),
    'recovery': ('Recovery', 'ms-settings:recovery'),
    'touchpad': ('Touchpad settings', 'ms-settings:devices-touchpad'),
    'camera': ('Camera settings', 'ms-settings:camera'),
    'camera_privacy': ('Camera permissions', 'ms-settings:privacy-webcam'),
    'display': ('Display settings', 'ms-settings:display'),
    'graphics': ('Graphics preferences', 'ms-settings:display-advancedgraphics'),
    'personalization': ('Personalization', 'ms-settings:personalization'),
    'security': ('Windows Security settings', 'ms-settings:windowsdefender'),
    'network': ('Network settings', 'ms-settings:network-status'),
    'startup': ('Startup apps', 'ms-settings:startupapps'),
    'about': ('About this PC', 'ms-settings:about'),
    'power': ('Power and sleep settings', 'ms-settings:powersleep'),
    'settings': ('Windows Settings', 'ms-settings:'),
    'warranty': ('Lenovo warranty lookup', 'https://pcsupport.lenovo.com/us/en/warranty-lookup'),
    'support': ('Lenovo support', 'https://pcsupport.lenovo.com/us/en/'),
    'vantage_store': ('Lenovo Vantage in Microsoft Store', 'ms-windows-store://pdp/?ProductId=9WZDNCRFJ4MV'),
}


def is_admin():
    return bool(ctypes.windll.shell32.IsUserAnAdmin())


def open_destination(key):
    if not isinstance(key, str):
        return {'opened': False, 'error': 'Unknown destination.'}
    if key == 'vantage':
        # Discover the installed AUMID instead of assuming future manifest IDs.
        script = """$ErrorActionPreference='Stop';
        $p=Get-AppxPackage -Name E046963F.LenovoCompanion | Select-Object -First 1;
        if (!$p) { throw 'Lenovo Vantage is not installed.' };
        $m=Get-AppxPackageManifest -Package $p.PackageFullName;
        $id=($m.Package.Applications.Application | Select-Object -First 1).Id;
        if (!$id) { throw 'Lenovo Vantage activation ID was not found.' };
        [Console]::Write($p.PackageFamilyName + '!' + $id)
        """
        result = run_hidden(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], 10)
        app_id = result.stdout.strip()
        if result.returncode or not app_id.startswith('E046963F.LenovoCompanion_') or '!' not in app_id:
            return {'opened': False, 'error': 'Lenovo Vantage is unavailable. Open its Microsoft Store listing to install it.', 'fallback': 'vantage_store'}
        subprocess.Popen([str(Path(os.environ['SystemRoot']) / 'explorer.exe'),
                          'shell:AppsFolder\\' + app_id],
                         creationflags=subprocess.CREATE_NO_WINDOW)
        return {'opened': True, 'message': 'Opened Lenovo Vantage. Choose the feature shown in Laptop Lens; Lenovo does not publish a direct page link.'}
    if key not in DESTINATIONS:
        return {'opened': False, 'error': 'Unknown destination.'}
    label, uri = DESTINATIONS[key]
    try:
        os.startfile(uri)
        return {'opened': True, 'message': f'Opened {label}.'}
    except OSError:
        return {'opened': False, 'error': f'Windows could not open {label}.', 'fallback': 'settings' if uri.startswith('ms-settings:') else 'support'}


DETAILS_SCRIPT = r"""
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$s=Get-CimInstance Win32_ComputerSystem
$p=Get-CimInstance Win32_ComputerSystemProduct
$b=Get-CimInstance Win32_BIOS
$o=Get-CimInstance Win32_OperatingSystem
$v=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$device=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\SQMClient' -Name MachineId -ErrorAction SilentlyContinue
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$ram=(Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum
$storage=(Get-PhysicalDisk | Measure-Object Size -Sum).Sum
@{
 deviceName=$s.Name; model=$s.Model; family=$p.Version; productNumber=$p.SKUNumber;
 serialNumber=$p.IdentifyingNumber; bios=$b.SMBIOSBIOSVersion;
 processor=$cpu.Name.Trim(); storageBytes=$storage; installedRamBytes=$ram;
 usableRamBytes=([long]$o.TotalVisibleMemorySize*1024);
 deviceId=$device.MachineId; productId=$v.ProductId;
 windows=$o.Caption; windowsVersion=$v.DisplayVersion; windowsBuild=$v.CurrentBuild
} | ConvertTo-Json -Compress
"""
PRIVATE_FIELDS = {'serialNumber', 'deviceId', 'productId'}
DETAIL_LABELS = {
    'deviceName': 'Device name', 'family': 'Product family', 'model': 'Machine type',
    'productNumber': 'Product number', 'serialNumber': 'Serial number', 'bios': 'BIOS version',
    'processor': 'Processor', 'storageBytes': 'Storage (bytes)', 'installedRamBytes': 'Installed RAM (bytes)',
    'usableRamBytes': 'Usable RAM (bytes)', 'deviceId': 'Device ID', 'productId': 'Windows product ID',
    'windows': 'Windows edition', 'windowsVersion': 'Windows version', 'windowsBuild': 'Windows build',
}


class DeviceDetails:
    def __init__(self):
        self._cached = None
        self._at = 0
        self._lock = threading.Lock()

    def read(self, reveal=False):
        if not isinstance(reveal, bool):
            raise ValueError('reveal must be Boolean')
        with self._lock:
            if self._cached is None or time.monotonic() - self._at > 120:
                result = run_hidden(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', DETAILS_SCRIPT], 20)
                if result.returncode:
                    raise RuntimeError('Windows could not read device details. Try again.')
                self._cached = json.loads(result.stdout.lstrip('\ufeff'))
                self._at = time.monotonic()
            return {key: ('Hidden' if key in PRIVATE_FIELDS and value and not reveal else value)
                    for key, value in self._cached.items()}

    def copy_text(self, key):
        if key != 'all' and key not in DETAIL_LABELS:
            raise ValueError('Unknown device detail')
        values = self.read(reveal=True)
        if key == 'all':
            return '\r\n'.join(f'{label}: {values.get(field) or "Not exposed by Windows"}' for field, label in DETAIL_LABELS.items())
        return str(values.get(key) or 'Not exposed by Windows')
