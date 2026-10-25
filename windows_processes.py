"""Low-overhead read-only process sampling using documented Win32 APIs.

Only PROCESS_QUERY_LIMITED_INFORMATION is requested. Protected processes are
skipped instead of invoking psutil's costly system-wide fallback per process.
"""
import ctypes as c
from ctypes import wintypes as w
import time
import os

import psutil


class MemoryCounters(c.Structure):
    _fields_ = [('cb', w.DWORD), ('PageFaultCount', w.DWORD)] + [
        (name, c.c_size_t) for name in (
            'PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage',
            'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]


class ProcessEntry(c.Structure):
    _fields_ = [('dwSize', w.DWORD), ('cntUsage', w.DWORD), ('pid', w.DWORD),
                ('heap', c.c_size_t), ('module', w.DWORD), ('threads', w.DWORD),
                ('parent', w.DWORD), ('priority', w.LONG), ('flags', w.DWORD), ('exe', w.WCHAR * 260)]


class IoCounters(c.Structure):
    _fields_ = [(n, c.c_ulonglong) for n in ('readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes')]


CRITICAL_NAMES = {'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
                  'services.exe', 'lsass.exe', 'secure system', 'memory compression'}


def filetime(value):
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


def cpu_delta(previous, created, ticks, at, cores):
    if not previous or previous[0] != created or ticks < previous[1] or at <= previous[2]:
        return None
    return round(min(100, (ticks - previous[1]) / 10_000_000 / (at - previous[2]) / cores * 100), 2)


class WindowsProcesses:
    def __init__(self):
        self.kernel = c.WinDLL('kernel32', use_last_error=True)
        self.kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        self.kernel.OpenProcess.restype = w.HANDLE
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.kernel.CloseHandle.restype = w.BOOL
        self.kernel.GetProcessTimes.argtypes = [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4
        self.kernel.GetProcessTimes.restype = w.BOOL
        self.kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = w.BOOL
        self.kernel.K32GetProcessMemoryInfo.argtypes = [w.HANDLE, c.POINTER(MemoryCounters), w.DWORD]
        self.kernel.K32GetProcessMemoryInfo.restype = w.BOOL
        self.kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
        self.kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
        self.kernel.Process32FirstW.argtypes = [w.HANDLE, c.POINTER(ProcessEntry)]
        self.kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(ProcessEntry)]
        self.kernel.GetProcessHandleCount.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
        self.kernel.GetProcessIoCounters.argtypes = [w.HANDLE, c.POINTER(IoCounters)]
        self.previous = {}
        self.cores = psutil.cpu_count() or 1

    def sample(self):
        rows, live, skipped = [], {}, 0
        entries = {}
        snapshot = self.kernel.CreateToolhelp32Snapshot(2, 0)
        if snapshot and snapshot != c.c_void_p(-1).value:
            try:
                entry = ProcessEntry(); entry.dwSize = c.sizeof(entry)
                ok = self.kernel.Process32FirstW(snapshot, c.byref(entry))
                while ok:
                    entries[entry.pid] = (entry.parent, entry.threads)
                    ok = self.kernel.Process32NextW(snapshot, c.byref(entry))
            finally:
                self.kernel.CloseHandle(snapshot)
        for pid in entries or psutil.pids():
            if pid == 0:
                continue  # System Idle Process is idle capacity, never workload.
            handle = self.kernel.OpenProcess(0x1000, False, pid)
            if not handle:
                skipped += 1
                continue
            try:
                created, exited, kernel, user = (w.FILETIME() for _ in range(4))
                if not self.kernel.GetProcessTimes(handle, c.byref(created), c.byref(exited), c.byref(kernel), c.byref(user)):
                    skipped += 1
                    continue
                identity = filetime(created)
                ticks, at = filetime(kernel) + filetime(user), time.monotonic()
                old = self.previous.get(pid)
                percent = cpu_delta(old, identity, ticks, at, self.cores)
                name = old[3] if old and old[0] == identity else None
                path = old[4] if old and old[0] == identity else None
                if not name:
                    buffer, length = c.create_unicode_buffer(32768), w.DWORD(32768)
                    if self.kernel.QueryFullProcessImageNameW(handle, 0, buffer, c.byref(length)):
                        path = buffer.value
                        name = buffer.value.rsplit('\\', 1)[-1]
                    else:
                        name = 'System' if pid == 4 else f'Process {pid}'
                memory = MemoryCounters()
                memory.cb = c.sizeof(memory)
                rss = memory.WorkingSetSize if self.kernel.K32GetProcessMemoryInfo(handle, c.byref(memory), memory.cb) else None
                handles, io = w.DWORD(), IoCounters()
                handle_count = handles.value if self.kernel.GetProcessHandleCount(handle, c.byref(handles)) else None
                io_valid = self.kernel.GetProcessIoCounters(handle, c.byref(io))
                io_values = (io.readBytes, io.writeBytes) if io_valid else None
                io_rates = [None, None]
                if old and old[0] == identity and old[5] and io_values and at > old[2] and all(a >= b for a, b in zip(io_values, old[5])):
                    io_rates = [(a-b)/(at-old[2]) for a,b in zip(io_values, old[5])]
                live[pid] = (identity, ticks, at, name, path, io_values)
                parent, threads = entries.get(pid, (None, None))
                rows.append({'pid': pid, 'identity': str(identity), 'name': name, 'cpu': percent, 'memory': rss,
                             'parentPid': parent, 'threads': threads, 'handles': handle_count,
                             'ioRead': io_rates[0], 'ioWrite': io_rates[1],
                             'canEnd': bool(path and pid != os.getpid() and name.lower() not in CRITICAL_NAMES)})
            finally:
                self.kernel.CloseHandle(handle)
        self.previous = live
        return rows, skipped

    def path_for(self, pid, identity):
        row = self.previous.get(pid)
        return row[4] if row and str(row[0]) == identity else None
