"""Identity-checked process actions. Executable paths remain in the native layer."""
import base64
import collections
import ctypes as c
from ctypes import wintypes as w
import os
from pathlib import Path
import subprocess
import threading

from windows_processes import WindowsProcesses, CRITICAL_NAMES, filetime


class ShellFileInfo(c.Structure):
    _fields_ = [('icon', w.HANDLE), ('index', c.c_int), ('attributes', w.DWORD),
                ('displayName', w.WCHAR * 260), ('typeName', w.WCHAR * 80)]


def validate_reference(pid, identity):
    if isinstance(pid, bool) or not isinstance(pid, int) or not 4 < pid <= 0xffffffff:
        raise ValueError('Select a running user process.')
    if not isinstance(identity, str) or not identity.isdigit() or not 1 <= len(identity) <= 20:
        raise ValueError('Refresh the process list and try again.')


class ProcessActions:
    def __init__(self, sampler):
        self.sampler = sampler
        self.win = WindowsProcesses().kernel
        self.win.IsProcessCritical.argtypes = [w.HANDLE, c.POINTER(w.BOOL)]
        self.win.IsProcessCritical.restype = w.BOOL
        self.win.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
        self.win.TerminateProcess.restype = w.BOOL
        self.cache = collections.OrderedDict()
        self.lock = threading.Lock()

    def _open(self, pid, identity, terminate=False):
        validate_reference(pid, identity)
        handle = self.win.OpenProcess(0x1000 | (1 if terminate else 0), False, pid)
        if not handle:
            raise OSError('The process exited or Windows denied access.')
        try:
            created, exited, kernel, user = (w.FILETIME() for _ in range(4))
            if not self.win.GetProcessTimes(handle, c.byref(created), c.byref(exited), c.byref(kernel), c.byref(user)) or str(filetime(created)) != identity:
                raise ValueError('The process changed or exited. Refresh and select it again.')
            buffer, length = c.create_unicode_buffer(32768), w.DWORD(32768)
            if not self.win.QueryFullProcessImageNameW(handle, 0, buffer, c.byref(length)):
                raise OSError('Windows did not expose this executable location.')
            return handle, buffer.value
        except Exception:
            self.win.CloseHandle(handle)
            raise

    def end(self, pid, identity, confirm):
        handle, path = self._open(pid, identity, terminate=True)
        try:
            critical = w.BOOL()
            if pid == os.getpid() or Path(path).name.lower() in CRITICAL_NAMES or not self.win.IsProcessCritical(handle, c.byref(critical)) or critical.value:
                raise ValueError('This system process cannot be ended from Laptop Lens.')
            if not confirm('End process?', f'End {Path(path).name} (PID {pid})? Unsaved work in this process may be lost.'):
                return {'success': False, 'cancelled': True}
            # The same kernel handle is retained across confirmation: PID reuse
            # cannot redirect TerminateProcess to a replacement process.
            if not self.win.TerminateProcess(handle, 1):
                raise OSError('Windows denied the request or the process already exited.')
            return {'success': True, 'message': 'Process ended.'}
        finally:
            self.win.CloseHandle(handle)

    def location(self, pid, identity):
        handle, path = self._open(pid, identity)
        try:
            if not Path(path).is_file():
                raise OSError('The executable is no longer present.')
            subprocess.Popen(['explorer.exe', '/select,', path], creationflags=subprocess.CREATE_NO_WINDOW)
            return {'opened': True}
        finally:
            self.win.CloseHandle(handle)

    def icons(self, references):
        if not isinstance(references, list) or len(references) > 32:
            raise ValueError('Request up to 32 process icons at once.')
        icons, names = {}, {}
        with self.lock:
            for ref in references:
                if not isinstance(ref, dict):
                    continue
                pid, identity = ref.get('pid'), ref.get('identity')
                try:
                    validate_reference(pid, identity)
                    path = self.sampler.path_for(pid, identity)
                    if not path or path.startswith('\\\\'):
                        continue
                    self.win.GetDriveTypeW.argtypes = [w.LPCWSTR]
                    if self.win.GetDriveTypeW(Path(path).anchor) == 4:
                        continue  # Never load shell resources from network drives.
                    key = path.lower()
                    if key not in self.cache:
                        self.cache[key] = self._extract(path)
                        if len(self.cache) > 256:
                            self.cache.popitem(last=False)
                    else:
                        self.cache.move_to_end(key)
                    png, name = self.cache[key]
                    row = f'{pid}:{identity}'
                    if png:
                        icons[row] = png
                    if name:
                        names[row] = name
                except (ValueError, OSError):
                    continue
        return {'icons': icons, 'names': names}

    @staticmethod
    def _extract(path):
        """Shell-owned HICON is copied to PNG and destroyed on every path."""
        import clr
        clr.AddReference('System.Drawing')
        from System.Drawing import Icon
        from System.Drawing.Imaging import ImageFormat
        from System.Diagnostics import FileVersionInfo
        from System.IO import MemoryStream
        from System import IntPtr
        shell, user, ole = c.WinDLL('shell32'), c.WinDLL('user32'), c.WinDLL('ole32')
        shell.SHGetFileInfoW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(ShellFileInfo), w.UINT, w.UINT]
        shell.SHGetFileInfoW.restype = c.c_size_t
        user.DestroyIcon.argtypes = [w.HANDLE]
        ole.CoInitializeEx.argtypes = [c.c_void_p, w.DWORD]
        initialized = ole.CoInitializeEx(None, 2) in (0, 1)
        info, bitmap, stream, borrowed = ShellFileInfo(), None, None, None
        png, name = None, None
        try:
            try:
                name = str(FileVersionInfo.GetVersionInfo(path).FileDescription or '')[:160] or None
            except Exception:
                pass
            if shell.SHGetFileInfoW(path, 0, c.byref(info), c.sizeof(info), 0x100 | 0x1) and info.icon:
                borrowed = Icon.FromHandle(IntPtr(info.icon))
                bitmap, stream = borrowed.ToBitmap(), MemoryStream()
                bitmap.Save(stream, ImageFormat.Png)
                png = 'data:image/png;base64,' + base64.b64encode(bytes(stream.ToArray())).decode('ascii')
            return png, name
        except Exception:
            return None, name
        finally:
            if stream is not None: stream.Dispose()
            if bitmap is not None: bitmap.Dispose()
            if borrowed is not None: borrowed.Dispose()
            if info.icon: user.DestroyIcon(info.icon)
            if initialized: ole.CoUninitialize()


def run_new_task():
    # Official parameterless Shell Run dialog; JS never supplies executable text.
    subprocess.Popen(['powershell.exe', '-NoLogo', '-NoProfile', '-STA', '-Command',
                      '(New-Object -ComObject Shell.Application).FileRun()'], creationflags=subprocess.CREATE_NO_WINDOW)
    return {'opened': True, 'message': 'Windows Run dialog opened.'}
