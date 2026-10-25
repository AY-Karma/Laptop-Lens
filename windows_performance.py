"""Fast native performance gauges and persistent, localization-aware PDH rates."""
import ctypes as c
from ctypes import wintypes as w
import math
import re
import socket
import time

import psutil


class PerformanceInformation(c.Structure):
    _fields_ = [('cb', w.DWORD)] + [(name, c.c_size_t) for name in (
        'CommitTotal', 'CommitLimit', 'CommitPeak', 'PhysicalTotal', 'PhysicalAvailable',
        'SystemCache', 'KernelTotal', 'KernelPaged', 'KernelNonpaged', 'PageSize')] + [
        ('HandleCount', w.DWORD), ('ProcessCount', w.DWORD), ('ThreadCount', w.DWORD)]


class CounterUnion(c.Union):
    _fields_ = [('doubleValue', c.c_double), ('largeValue', c.c_longlong)]


class CounterValue(c.Structure):
    _fields_ = [('CStatus', w.DWORD), ('value', CounterUnion)]


class CounterInfoHead(c.Structure):
    _fields_ = [(name, w.DWORD) for name in ('dwLength', 'dwType', 'CVersion', 'CStatus')] + [
        ('lScale', w.LONG), ('lDefaultScale', w.LONG), ('dwUserData', c.c_size_t),
        ('dwQueryUserData', c.c_size_t), ('szFullPath', w.LPWSTR)]


class CounterPath(c.Structure):
    _fields_ = [(name, w.LPWSTR) for name in ('szMachineName', 'szObjectName', 'szInstanceName', 'szParentInstance')] + [
        ('dwInstanceIndex', w.DWORD), ('szCounterName', w.LPWSTR)]


class PdhCounters:
    MEMORY = ('Standby Cache Reserve Bytes', 'Standby Cache Normal Priority Bytes', 'Standby Cache Core Bytes', 'Modified Page List Bytes')
    DISKS = {'idle': '% Idle Time', 'response': 'Avg. Disk sec/Transfer',
             'read': 'Disk Read Bytes/sec', 'write': 'Disk Write Bytes/sec'}

    def __init__(self):
        self.dll = c.WinDLL('pdh', use_last_error=True)
        self.query = w.HANDLE()
        self.scalar = {}
        self.disks = {}
        self.paths = set()
        self.last_discovery = 0
        self.warmed = False
        self.dll.PdhOpenQueryW.argtypes = [w.LPCWSTR, c.c_size_t, c.POINTER(w.HANDLE)]
        self.dll.PdhAddEnglishCounterW.argtypes = [w.HANDLE, w.LPCWSTR, c.c_size_t, c.POINTER(w.HANDLE)]
        self.dll.PdhAddCounterW.argtypes = self.dll.PdhAddEnglishCounterW.argtypes
        self.dll.PdhCollectQueryData.argtypes = [w.HANDLE]
        self.dll.PdhCloseQuery.argtypes = [w.HANDLE]
        self.dll.PdhRemoveCounter.argtypes = [w.HANDLE]
        self.dll.PdhGetCounterInfoW.argtypes = [w.HANDLE, w.BOOL, c.POINTER(w.DWORD), c.c_void_p]
        self.dll.PdhExpandWildCardPathW.argtypes = [w.LPCWSTR, w.LPCWSTR, w.LPWSTR, c.POINTER(w.DWORD), w.DWORD]
        self.dll.PdhParseCounterPathW.argtypes = [w.LPCWSTR, c.c_void_p, c.POINTER(w.DWORD), w.DWORD]
        self.dll.PdhGetFormattedCounterValue.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.DWORD), c.POINTER(CounterValue)]
        if self.dll.PdhOpenQueryW(None, 0, c.byref(self.query)):
            raise OSError('Windows performance query is unavailable')
        for name in self.MEMORY:
            handle = w.HANDLE()
            if not self.dll.PdhAddEnglishCounterW(self.query, '\\Memory\\' + name, 0, c.byref(handle)):
                self.scalar[name] = handle
        self.discover_disks()

    def discover_disks(self):
        self.last_discovery = time.monotonic()
        for key, name in self.DISKS.items():
            temporary = w.HANDLE()
            if self.dll.PdhAddEnglishCounterW(self.query, '\\PhysicalDisk(*)\\' + name, 0, c.byref(temporary)):
                continue
            try:
                size = w.DWORD()
                self.dll.PdhGetCounterInfoW(temporary, False, c.byref(size), None)
                if not 48 <= size.value <= 1048576:
                    continue
                info = c.create_string_buffer(size.value)
                if self.dll.PdhGetCounterInfoW(temporary, False, c.byref(size), info):
                    continue
                localized = c.cast(info, c.POINTER(CounterInfoHead)).contents.szFullPath
                count = w.DWORD()
                self.dll.PdhExpandWildCardPathW(None, localized, None, c.byref(count), 0)
                if not 1 <= count.value <= 1048576:
                    continue
                expanded = c.create_unicode_buffer(count.value)
                if self.dll.PdhExpandWildCardPathW(None, localized, expanded, c.byref(count), 0):
                    continue
                for path in c.wstring_at(c.addressof(expanded), count.value).split('\0'):
                    if not path or path in self.paths:
                        continue
                    path_size = w.DWORD()
                    self.dll.PdhParseCounterPathW(path, None, c.byref(path_size), 0)
                    if not 48 <= path_size.value <= 1048576:
                        continue
                    path_buffer = c.create_string_buffer(path_size.value)
                    if self.dll.PdhParseCounterPathW(path, path_buffer, c.byref(path_size), 0):
                        continue
                    instance = c.cast(path_buffer, c.POINTER(CounterPath)).contents.szInstanceName
                    if not instance or instance == '_Total':
                        continue
                    handle = w.HANDLE()
                    if self.dll.PdhAddCounterW(self.query, path, 0, c.byref(handle)):
                        continue
                    self.paths.add(path)
                    self.disks.setdefault(instance, {})[key] = handle
            finally:
                self.dll.PdhRemoveCounter(temporary)

    def value(self, handle):
        value = CounterValue()
        if self.dll.PdhGetFormattedCounterValue(handle, 0x200 | 0x8000, None, c.byref(value)) or value.CStatus not in (0, 1):
            return None
        number = value.value.doubleValue
        return number if math.isfinite(number) and number >= 0 else None

    def sample(self):
        if time.monotonic() - self.last_discovery > 60:
            self.discover_disks()
        if self.dll.PdhCollectQueryData(self.query):
            return None, {}
        cache_parts = [self.value(self.scalar[n]) if n in self.scalar else None for n in self.MEMORY]
        cached = int(sum(cache_parts)) if all(v is not None for v in cache_parts) else None
        disks = {}
        if self.warmed:
            for instance, counters in self.disks.items():
                # Correlate only OS disk-number instances; never copy _Total.
                match = re.match(r'^(\d+)(?:\s|$)', instance)
                if not match:
                    continue
                raw = {key: self.value(handle) for key, handle in counters.items()}
                idle, response = raw.get('idle'), raw.get('response')
                disks[match.group(1)] = {
                    'instance': instance,
                    'activePercent': round(max(0, min(100, 100 - idle)), 2) if idle is not None and idle <= 100.01 else None,
                    'responseMs': round(response * 1000, 3) if response is not None else None,
                    'readBytesPerSec': raw.get('read'), 'writeBytesPerSec': raw.get('write')}
        self.warmed = True
        return cached, disks

    def close(self):
        if self.query:
            self.dll.PdhCloseQuery(self.query)
            self.query = None


def rates_between(previous, now, values):
    if previous is None:
        return [None] * len(values)
    at, before = previous
    elapsed = now - at
    if elapsed <= 0 or len(before) != len(values) or any(a < b for a, b in zip(values, before)):
        return [None] * len(values)
    return [(a - b) / elapsed for a, b in zip(values, before)]


class WindowsPerformance:
    def __init__(self):
        self.kernel = c.WinDLL('kernel32', use_last_error=True)
        self.psapi = c.WinDLL('psapi', use_last_error=True)
        self.psapi.GetPerformanceInfo.argtypes = [c.POINTER(PerformanceInformation), w.DWORD]
        self.psapi.GetPerformanceInfo.restype = w.BOOL
        self.kernel.GetPhysicallyInstalledSystemMemory.argtypes = [c.POINTER(c.c_ulonglong)]
        self.kernel.GetPhysicallyInstalledSystemMemory.restype = w.BOOL
        installed = c.c_ulonglong()
        self.installed_bytes = installed.value * 1024 if self.kernel.GetPhysicallyInstalledSystemMemory(c.byref(installed)) else None
        self.previous_nic = {}
        self.previous_disk = {}
        self.addresses = {}
        self.address_at = 0
        try:
            self.pdh = PdhCounters()
        except (OSError, AttributeError):
            self.pdh = None
        psutil.cpu_percent(percpu=True)

    def sample(self, cpu, memory, hardware, gpu):
        now = time.monotonic()
        info = PerformanceInformation()
        info.cb = c.sizeof(info)
        valid = bool(self.psapi.GetPerformanceInfo(c.byref(info), info.cb))
        cache, disk_rates = self.pdh.sample() if self.pdh else (None, {})
        mem = {'totalBytes': memory.total, 'inUseBytes': memory.total - memory.available,
               'availableBytes': memory.available, 'committedBytes': info.CommitTotal * info.PageSize if valid else None,
               'commitLimitBytes': info.CommitLimit * info.PageSize if valid else None,
               'cachedBytes': cache, 'systemCacheBytes': info.SystemCache * info.PageSize if valid else None,
               'pagedPoolBytes': info.KernelPaged * info.PageSize if valid else None,
               'nonPagedPoolBytes': info.KernelNonpaged * info.PageSize if valid else None, 'compressedBytes': None}
        frequency = psutil.cpu_freq()
        cpu_data = {'percent': cpu, 'perCore': psutil.cpu_percent(percpu=True),
                    'frequencyMhz': frequency.current if frequency else None, 'logicalProcessors': psutil.cpu_count(),
                    'processCount': info.ProcessCount if valid else None, 'threadCount': info.ThreadCount if valid else None,
                    'handleCount': info.HandleCount if valid else None, 'uptimeSeconds': time.time() - psutil.boot_time()}
        disk_info = {str(d['id']): d for d in hardware.get('performanceDisks', [])}
        disks = []
        for device, values in (psutil.disk_io_counters(perdisk=True) or {}).items():
            match = re.fullmatch(r'PhysicalDrive(\d+)', device)
            if not match:
                continue
            key = match.group(1)
            before = self.previous_disk.get(device)
            rates = rates_between(before, now, (values.read_bytes, values.write_bytes))
            self.previous_disk[device] = now, (values.read_bytes, values.write_bytes)
            measured = disk_rates.get(key, {})
            meta = disk_info.get(key, {})
            # Metadata comes from Get-Disk.Number, not storage-pool physical IDs.
            label = meta.get('label') or f'Disk {key}'
            disks.append({**meta, 'id': key, 'name': f'Disk {key}', 'label': label,
                          'activePercent': measured.get('activePercent'), 'responseMs': measured.get('responseMs'),
                          'readBytesPerSec': measured.get('readBytesPerSec', rates[0]),
                          'writeBytesPerSec': measured.get('writeBytesPerSec', rates[1])})
        if now - self.address_at > 15:
            self.addresses, self.address_at = psutil.net_if_addrs(), now
        adapters = {n['name']: n for n in hardware.get('networkAdapters', [])}
        stats = psutil.net_if_stats()
        networks = []
        visible_nics = set()
        for name, values in psutil.net_io_counters(pernic=True).items():
            stat = stats.get(name)
            if not stat or 'loopback' in name.lower() or (adapters and name not in adapters) or (not adapters and not stat.isup):
                continue
            meta = adapters.get(name, {})
            visible_nics.add(name)
            old = self.previous_nic.get(name)
            # Reconnect/disconnect warms a new baseline rather than showing spikes.
            if old and old[2] != stat.isup:
                old = None
            rates = rates_between(old[:2] if old else None, now, (values.bytes_sent, values.bytes_recv))
            self.previous_nic[name] = now, (values.bytes_sent, values.bytes_recv), stat.isup
            addresses = self.addresses.get(name, [])
            networks.append({'id': name, 'name': name, 'description': meta.get('description') or name,
                             'isUp': stat.isup, 'speedMbps': meta.get('speedMbps') or (stat.speed if stat.speed > 0 else None),
                             'mac': next((a.address for a in addresses if a.family == psutil.AF_LINK), None),
                             'ipv4': next((a.address for a in addresses if a.family == socket.AF_INET), None),
                             'ipv6': next((a.address for a in addresses if a.family == socket.AF_INET6), None),
                             'sendBytesPerSec': rates[0], 'receiveBytesPerSec': rates[1]})
        self.previous_nic = {k: v for k, v in self.previous_nic.items() if k in visible_nics}
        gpus = []
        if gpu:
            mib = 1024 ** 2
            gpus.append({'id': 'nvidia-0', 'name': gpu['name'], 'percent': gpu.get('percent'),
                         'temperature': gpu.get('temperature'), 'powerWatts': gpu.get('watts'),
                         'dedicatedUsedBytes': gpu['memoryUsedMb'] * mib if gpu.get('memoryUsedMb') is not None else None,
                         'dedicatedTotalBytes': gpu['memoryTotalMb'] * mib if gpu.get('memoryTotalMb') is not None else None,
                         'updatedAt': gpu['updatedAt'], 'driverVersion': gpu.get('driverVersion')})
        return {'cpu': cpu_data, 'memory': mem, 'disks': disks, 'networks': networks, 'gpus': gpus}

    def close(self):
        if getattr(self, 'pdh', None):
            self.pdh.close()

    def __del__(self):
        self.close()


def graph_sample(performance):
    return {'memoryUsedBytes': performance['memory']['inUseBytes'], 'cpuPerCore': performance['cpu']['perCore'],
            'disks': {d['id']: {k: d.get(k) for k in ('activePercent', 'readBytesPerSec', 'writeBytesPerSec', 'responseMs')} for d in performance['disks']},
            'networks': {n['id']: {k: n.get(k) for k in ('sendBytesPerSec', 'receiveBytesPerSec')} for n in performance['networks']},
            'gpus': {g['id']: {k: g.get(k) for k in ('percent', 'dedicatedUsedBytes')} for g in performance['gpus']}}
