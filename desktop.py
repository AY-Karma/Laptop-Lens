"""Native Windows entry point; all telemetry belongs to this window's lifetime."""
import argparse
import csv
import ctypes
from ctypes import wintypes
import io
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from app import LocalServer, ROOT, make_handler
from telemetry import Monitor
from legion_controls import LegionControls
from system_actions import DeviceDetails, is_admin, open_destination
from process_actions import ProcessActions, run_new_task

TITLE = 'Laptop Lens'
MUTEX_NAME = r'Local\LaptopLens.Desktop.0.2'


def request_control_access():
    """Reopen this app through Windows consent, never a stored credential."""
    if getattr(sys, 'frozen', False):
        executable, arguments = sys.executable, []
    else:
        executable = str(Path(sys.executable).with_name('pythonw.exe'))
        arguments = [str(ROOT / 'desktop.py')]
    arguments += ['--wait-for-exit', str(os.getpid())]
    shell = ctypes.WinDLL('shell32', use_last_error=True)
    shell.ShellExecuteW.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int]
    shell.ShellExecuteW.restype = ctypes.c_ssize_t
    return shell.ShellExecuteW(None, 'runas', executable, subprocess.list2cmdline(arguments), str(Path(executable).parent), 1) > 32


def serialize_export(snapshot, kind):
    if kind == 'json':
        return json.dumps(snapshot, indent=2, allow_nan=False), 'laptop-lens-report.json'
    if kind == 'csv':
        stream = io.StringIO(newline='')
        writer = csv.DictWriter(stream, extrasaction='ignore', fieldnames=[
            'timestamp', 'cpu', 'memoryPercent', 'diskRead', 'diskWrite', 'netDown', 'netUp'])
        writer.writeheader()
        writer.writerows(snapshot['history'])
        return stream.getvalue(), 'laptop-lens-history.csv'
    raise ValueError('Choose json or csv')


class DesktopApi:
    def __init__(self, monitor):
        self._monitor = monitor
        self._window = None
        self._save_lock = threading.Lock()
        self._controls = LegionControls()
        self._details = DeviceDetails()
        self._process_actions = ProcessActions(monitor.process_sampler)

    def get_process_icons(self, references):
        try:
            return self._process_actions.icons(references)
        except Exception:
            logging.exception('Process icons unavailable')
            return {'icons': {}, 'names': {}}

    def is_window_minimized(self):
        try:
            user32 = ctypes.WinDLL('user32', use_last_error=True)
            user32.IsIconic.argtypes = [wintypes.HWND]
            user32.IsIconic.restype = wintypes.BOOL
            handle = self._window.native.Handle.ToInt32()
            return bool(user32.IsIconic(handle))
        except Exception:
            logging.exception('Could not read native window visibility')
            return False

    def end_process(self, pid, identity):
        try:
            return self._process_actions.end(pid, identity, self._window.create_confirmation_dialog)
        except (ValueError, OSError) as exc:
            return {'success': False, 'error': str(exc)}

    def open_process_location(self, pid, identity):
        try:
            return self._process_actions.location(pid, identity)
        except (ValueError, OSError) as exc:
            return {'opened': False, 'error': str(exc)}

    def run_new_task(self):
        try:
            return run_new_task()
        except OSError:
            return {'opened': False, 'error': 'Windows could not open the Run dialog.'}

    def open_destination(self, key):
        try:
            return open_destination(key)
        except Exception:
            logging.exception('Native destination failed')
            return {'opened': False, 'error': 'Windows could not open this destination.'}

    def get_device_controls(self, refresh=False):
        try:
            if not isinstance(refresh, bool):
                raise ValueError('refresh must be Boolean')
            return self._controls.read(force=refresh)
        except Exception:
            logging.exception('Device controls read failed')
            return {'admin': is_admin(), 'controls': {}, 'error': 'Could not read Lenovo controls. Open Lenovo Vantage or refresh.'}

    def set_device_control(self, key, value):
        try:
            return self._controls.set(key, value)
        except (ValueError, RuntimeError, OSError) as exc:
            return {'success': False, 'error': str(exc)}

    def get_device_details(self, reveal=False):
        try:
            return {'details': self._details.read(reveal)}
        except Exception as exc:
            return {'error': str(exc)}

    def copy_device_detail(self, key):
        try:
            from System import Action
            from System.Windows.Forms import Clipboard
            text = self._details.copy_text(key)
            self._window.native.Invoke(Action(lambda: Clipboard.SetText(text)))
            return {'copied': True}
        except Exception:
            return {'copied': False, 'error': 'Windows could not copy this detail. Try again.'}

    def enable_device_controls(self):
        if is_admin():
            return {'restarting': False, 'message': 'Lenovo controls already have administrator access.'}
        if not request_control_access():
            return {'restarting': False, 'error': 'Administrator access was cancelled or Windows could not reopen the app. Lenovo Vantage routes still work.'}
        self._window.destroy()
        return {'restarting': True}

    def save_report(self, kind):
        import webview
        if not self._save_lock.acquire(blocking=False):
            return {'saved': False, 'cancelled': True}
        try:
            # Snapshot at click time, not after the user finishes the dialog.
            content, name = serialize_export(self._monitor.snapshot(), kind)
            selection = self._window.create_file_dialog(
                webview.FileDialog.SAVE, save_filename=name,
                file_types=(f'{kind.upper()} files (*.{kind})', 'All files (*.*)'))
            if not selection:
                return {'saved': False, 'cancelled': True}
            destination = Path(selection[0] if isinstance(selection, (list, tuple)) else selection)
            destination.write_text(content, encoding='utf-8', newline='')
            return {'saved': True, 'name': destination.name}
        except Exception:
            logging.exception('Export failed')
            return {'saved': False, 'error': 'Could not save the report. Choose a writable location and try again.'}
        finally:
            self._save_lock.release()


class SingleInstance:
    """A second shortcut launch restores the existing native window."""
    def __init__(self, name=MUTEX_NAME):
        self._kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self._kernel.CreateMutexExW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        self._kernel.CreateMutexExW.restype = wintypes.HANDLE
        self._kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self._kernel.CreateMutexExW(None, name, 0, 0x100000)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.exists = ctypes.get_last_error() == 183

    def restore(self):
        user = ctypes.WinDLL('user32', use_last_error=True)
        user.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user.FindWindowW.restype = wintypes.HWND
        user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user.SetForegroundWindow.argtypes = [wintypes.HWND]
        for _ in range(40):
            handle = user.FindWindowW(None, TITLE)
            if handle:
                user.ShowWindow(handle, 9)
                user.SetForegroundWindow(handle)
                return
            time.sleep(.1)

    def close(self):
        self._kernel.CloseHandle(self.handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--smoke-test', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--wait-for-exit', type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.wait_for_exit:
        import psutil
        try:
            psutil.Process(args.wait_for_exit).wait(timeout=20)
        except psutil.NoSuchProcess:
            pass
        except (psutil.TimeoutExpired, psutil.AccessDenied):
            ctypes.windll.user32.MessageBoxW(None, 'Close the previous Laptop Lens window, then open the app again.', TITLE, 0x10)
            return
    app_data = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Laptop Lens'
    app_data.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=app_data / 'desktop.log', level=logging.WARNING,
                        format='%(asctime)s %(levelname)s %(message)s')
    # Give the EXE its own taskbar identity, independent of Python or Edge.
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('LaptopLens.Desktop')
    instance = SingleInstance(MUTEX_NAME + f'.Smoke.{os.getpid()}' if args.smoke_test else MUTEX_NAME)
    if instance.exists:
        instance.restore()
        instance.close()
        return
    monitor, server, thread = None, None, None
    try:
        import webview
        if not (ROOT / 'dist' / 'index.html').is_file():
            raise RuntimeError('The desktop bundle is missing its interface. Rebuild Laptop Lens.')
        monitor = Monitor()
        # Start stopped until the native window reports whether it is minimized.
        monitor.set_active(False)
        server = LocalServer(('127.0.0.1', 0), lambda *a: None)
        server.RequestHandlerClass = make_handler(monitor, server.server_port, desktop=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        monitor.start()
        if args.smoke_test:
            from desktop_smoke import SmokeApi
            api = SmokeApi(monitor, args.smoke_test, server.server_port)
        else:
            api = DesktopApi(monitor)
        window = webview.create_window(
            TITLE, f'http://127.0.0.1:{server.server_port}', js_api=api,
            width=1400, height=940, min_size=(960, 680),
            background_color='#0d0d0c', text_select=True, zoomable=False)
        api._window = window
        def sync_window_activity(*_):
            api._monitor.set_active(not api.is_window_minimized())
        window.events.shown += sync_window_activity
        window.events.restored += sync_window_activity
        window.events.minimized += lambda *_: api._monitor.set_active(False)
        webview.settings['ALLOW_FILE_URLS'] = False
        webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = False
        if args.smoke_test:
            api._attach(window)
        webview.start(gui='edgechromium', debug=False, private_mode=bool(args.smoke_test),
                      storage_path=None if args.smoke_test else str(app_data / 'WebView2'), icon=str(ROOT / 'assets' / 'laptop-lens.ico'))
    except Exception as exc:
        logging.exception('Desktop startup failed')
        ctypes.windll.user32.MessageBoxW(
            None, f'{exc}\n\nDetails: {app_data / "desktop.log"}', TITLE, 0x10)
    finally:
        if monitor:
            monitor.request_stop()
            for worker in monitor.threads:
                worker.join(timeout=1)
        if server:
            server.shutdown()
            server.server_close()
        if thread:
            thread.join(timeout=1)
        instance.close()


if __name__ == '__main__':
    main()
