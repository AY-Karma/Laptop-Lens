"""Read-only Windows telemetry. Slow hardware probes never block live sampling."""
import collections
import csv
import io
import json
import platform
import shutil
import subprocess
import threading
import time

import psutil
from windows_processes import WindowsProcesses
from windows_performance import WindowsPerformance, graph_sample

POWERSHELL = r"""
$ErrorActionPreference = 'Stop'
$r = @{}
function Probe($key, $code) {
  try { $r[$key] = & $code } catch { $r[$key] = $null; $r[($key + 'Error')] = $_.Exception.Message }
}
Probe 'system' { Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model }
Probe 'cpu' { Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,L2CacheSize,L3CacheSize }
Probe 'memory' {
  $modules = @(Get-CimInstance Win32_PhysicalMemory)
  $array = Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1
  $m = $modules | Select-Object -First 1
  @{ installedBytes = ($modules | Measure-Object Capacity -Sum).Sum; speedMts = $m.ConfiguredClockSpeed; memoryType = switch ($m.SMBIOSMemoryType) { 26 {'DDR4'} 34 {'DDR5'} default {'Memory'} }; formFactor = switch ($m.FormFactor) { 8 {'DIMM'} 12 {'SODIMM'} default {'Unknown'} }; slotsUsed = $modules.Count; slotsTotal = $array.MemoryDevices }
}
Probe 'performanceDisks' { @(Get-Disk | ForEach-Object {
  $d = $_; $letters = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | Where-Object DriveLetter | ForEach-Object { "$($_.DriveLetter):" })
  $physical = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.SerialNumber -and $d.SerialNumber -and $_.SerialNumber.Trim() -eq $d.SerialNumber.Trim() })
  @{ id = "$($d.Number)"; label = "Disk $($d.Number)$(if($letters.Count){' (' + ($letters -join ', ') + ')'})"; model = $d.FriendlyName; busType = $d.BusType.ToString(); totalBytes = $d.Size; isSystem = $d.IsSystem; mediaType = if($physical.Count -eq 1) {$physical[0].MediaType.ToString()} else {$null} }
}) }
Probe 'networkAdapters' { @(Get-NetAdapter -Physical | ForEach-Object { @{ name = $_.Name; description = $_.InterfaceDescription; speedMbps = [double]$_.TransmitLinkSpeed / 1000000 } }) }
Probe 'bios' { Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion,ReleaseDate }
Probe 'batteryFull' { @(Get-CimInstance -Namespace root/wmi BatteryFullChargedCapacity | Select-Object InstanceName,FullChargedCapacity) }
Probe 'batteryDesign' { @(Get-CimInstance -Namespace root/wmi BatteryStaticData | Select-Object InstanceName,DesignedCapacity) }
Probe 'batteryCycles' { @(Get-CimInstance -Namespace root/wmi BatteryCycleCount | Select-Object InstanceName,CycleCount) }
Probe 'batteryStatus' { @(Get-CimInstance -Namespace root/wmi BatteryStatus | Select-Object InstanceName,PowerOnline,Charging,Discharging,RemainingCapacity,Voltage,ChargeRate,DischargeRate) }
Probe 'disks' { @(Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,MediaType,HealthStatus,OperationalStatus,Size) }
Probe 'services' { @(Get-Service '*Lenovo*','*Vantage*' | Select-Object Name,DisplayName,@{Name='Status';Expression={$_.Status.ToString()}}) }
Probe 'powerPlan' { (powercfg /getactivescheme | Out-String).Trim() }
Probe 'startup' { @(Get-CimInstance Win32_StartupCommand | Select-Object Name,Location) }
$r | ConvertTo-Json -Depth 6 -Compress
"""


def run_hidden(args, timeout=15, stop=None):
    """Allow app shutdown to cancel only the helper processes we started."""
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                          encoding='utf-8', errors='replace') as child:
        deadline = time.monotonic() + timeout
        while True:
            try:
                stdout, stderr = child.communicate(timeout=.25)
                return subprocess.CompletedProcess(args, child.returncode, stdout, stderr)
            except subprocess.TimeoutExpired:
                if (stop and stop.is_set()) or time.monotonic() >= deadline:
                    child.kill()
                    child.communicate()
                    raise TimeoutError('Telemetry helper cancelled or timed out')


def as_list(value):
    return value if isinstance(value, list) else ([value] if value else [])


def battery_details(hardware):
    """Match battery instances rather than mixing capacities from different packs."""
    fulls = {b.get('InstanceName'): b for b in as_list(hardware.get('batteryFull'))}
    designs = {b.get('InstanceName'): b for b in as_list(hardware.get('batteryDesign'))}
    cycles = {b.get('InstanceName'): b for b in as_list(hardware.get('batteryCycles'))}
    result = []
    for key in fulls.keys() | designs.keys() | cycles.keys():
        full = fulls.get(key, {}).get('FullChargedCapacity')
        design = designs.get(key, {}).get('DesignedCapacity')
        valid = lambda n: isinstance(n, (int, float)) and 0 < n < 4294967295
        health = round(full / design * 100, 1) if valid(full) and valid(design) else None
        result.append({'fullMwh': full if valid(full) else None,
                       'designMwh': design if valid(design) else None,
                       'healthPercent': health, 'cycles': cycles.get(key, {}).get('CycleCount') or None})
    return result


def insights(samples, current):
    """Evidence-based observations, not a synthetic health score."""
    result = []
    window = [s for s in samples if s['timestamp'] >= current['timestamp'] - 60]
    sustained = len(window) >= 10 and window[-1]['timestamp'] - window[0]['timestamp'] >= 20
    if sustained and sum(s['cpu'] for s in window) / len(window) >= 80:
        result.append({'level': 'warn', 'title': 'Sustained CPU load', 'detail':
                       'CPU averaged at least 80% over the recent window. Check the CPU-sorted process list; load alone does not prove thermal throttling.'})
    if current['memory']['percent'] >= 85:
        result.append({'level': 'warn', 'title': 'Memory headroom is low', 'detail':
                       'At least 85% of physical memory is in use. Large apps may compete for RAM; sort processes by memory before closing anything.'})
    for d in current['volumes']:
        if d['percent'] >= 90:
            result.append({'level': 'warn', 'title': f"{d['mount']} is nearly full", 'detail':
                           'Less than 10% is free. Review large files in Windows Storage settings; this app never deletes files automatically.'})
    battery = current.get('battery')
    if battery and not battery['plugged'] and battery['percent'] <= 20:
        result.append({'level': 'warn', 'title': 'Low battery', 'detail': 'Battery is at or below 20% and running unplugged. Connect power or reduce workload.'})
    gpu = current.get('gpu') or {}
    if gpu.get('temperature') is not None and gpu['temperature'] >= 85:
        result.append({'level': 'warn', 'title': 'GPU temperature is elevated', 'detail':
                       'The NVIDIA GPU reports at least 85°C. Inspect cooling and workload. This threshold is advisory, not a model-specific thermal limit.'})
    if not result:
        result.append({'level': 'ok', 'title': 'No pressure flags in the available readings', 'detail':
                       'Current memory, free space, battery and GPU readings have not crossed the displayed thresholds. This is not a hardware diagnostic or a clean bill of health.'})
    return result


class Monitor:
    def __init__(self, interval=2):
        self.interval = interval
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.sample_wake = threading.Event()
        self.hardware_wake = threading.Event()
        self.gpu_wake = threading.Event()
        self.active = True
        self.activity_generation = 0
        self.processes_enabled = False
        self.processes_interval = 5
        self.processes_last_at = 0.0
        self.processes_rows = []
        self.processes_skipped = 0
        self.process_generation = 0
        self.samples = collections.deque(maxlen=3600)
        self.hardware = {}
        self.gpu = None
        self.gpu_enabled = True
        self.gpu_status = 'Detecting NVIDIA telemetry'
        self.current = None
        self.error = None
        self.started = time.time()
        self.process_sampler = WindowsProcesses()
        self.performance_sampler = WindowsPerformance()
        self.previous_io = None
        self.threads = []

    def start(self):
        for target in (self._sample_loop, self._hardware_loop, self._gpu_loop):
            t = threading.Thread(target=target, daemon=True)
            t.start()
            self.threads.append(t)

    def request_stop(self):
        self.stop.set()
        self.sample_wake.set()
        self.hardware_wake.set()
        self.gpu_wake.set()

    def _wait_for_activity(self, wake, timeout=None):
        """Wait without periodic wakeups while hidden; settings can wake workers."""
        with self.lock:
            wake.clear()
            active = self.active
        if not active:
            while not self.stop.is_set():
                with self.lock:
                    wake.clear()
                    if self.active:
                        return True
                wake.wait()
            return False
        if timeout is not None:
            wake.wait(timeout)
        return not self.stop.is_set()

    def _wait_for_gpu(self):
        while not self.stop.is_set():
            with self.lock:
                self.gpu_wake.clear()
                if self.active and self.gpu_enabled:
                    return True
            self.gpu_wake.wait()
        return False

    def set_active(self, active):
        if type(active) is not bool:
            raise ValueError('active must be Boolean')
        with self.lock:
            changed = self.active != active
            self.active = active
            if changed:
                self.activity_generation += 1
                if not active:
                    self.processes_rows = []
                    self.processes_last_at = 0.0
                    self.process_generation += 1
                    if self.current is not None:
                        self.current = {**self.current, 'processes': [], 'processesSkipped': 0}
                self.sample_wake.set()
                self.hardware_wake.set()
                self.gpu_wake.set()

    def set_processes_enabled(self, enabled, interval=5):
        if type(enabled) is not bool:
            raise ValueError('processesEnabled must be Boolean')
        if type(interval) is not int or interval not in (1, 2, 5):
            raise ValueError('Process refresh interval must be 1, 2 or 5 seconds')
        with self.lock:
            changed = self.processes_enabled != enabled or self.processes_interval != interval
            self.processes_enabled = enabled
            self.processes_interval = interval
            if changed:
                self.processes_rows = []
                self.processes_last_at = 0.0
                self.process_generation += 1
                if self.current is not None:
                    self.current = {**self.current, 'processes': [], 'processesSkipped': 0}
                self.sample_wake.set()

    def _hardware_loop(self):
        while not self.stop.is_set():
            if not self._wait_for_activity(self.hardware_wake):
                break
            started = time.time()
            try:
                if platform.system() != 'Windows':
                    raise RuntimeError('Windows CIM requires Windows')
                proc = run_hidden(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
                                   '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' + POWERSHELL], 40, self.stop)
                if proc.returncode:
                    raise RuntimeError(proc.stderr.strip()[:300])
                data = json.loads(proc.stdout.lstrip('\ufeff'))
                data['updatedAt'] = time.time()
                data['probeSeconds'] = round(time.time() - started, 2)
                data['batteries'] = battery_details(data)
                if data.get('memory'):
                    installed = self.performance_sampler.installed_bytes
                    data['memory']['hardwareReservedBytes'] = max(0, installed - psutil.virtual_memory().total) if installed else None
                with self.lock:
                    self.hardware = data
            except Exception as exc:
                with self.lock:
                    self.hardware = {**self.hardware, 'error': str(exc)}
            self._wait_for_activity(self.hardware_wake, 60)

    def _gpu_loop(self):
        executable = shutil.which('nvidia-smi')
        if not executable:
            with self.lock:
                self.gpu_status = 'NVIDIA driver telemetry unavailable; integrated GPU sensors are not exposed by this collector.'
            return
        while not self.stop.is_set():
            if not self._wait_for_gpu():
                break
            with self.lock:
                enabled = self.gpu_enabled
            if not enabled:
                continue
            try:
                proc = run_hidden([executable, '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,driver_version',
                                   '--format=csv,noheader,nounits'], 8, self.stop)
                if proc.returncode:
                    raise RuntimeError(proc.stderr.strip()[:200])
                row = next(csv.reader(io.StringIO(proc.stdout)))
                def number(value):
                    try:
                        return float(value.strip())
                    except ValueError:
                        return None
                gpu = dict(zip(['name', 'temperature', 'percent', 'memoryUsedMb', 'memoryTotalMb', 'watts'],
                               [row[0].strip()] + [number(v) for v in row[1:6]]))
                gpu['driverVersion'] = row[6].strip() if len(row) > 6 else None
                gpu['updatedAt'] = time.time()
                with self.lock:
                    if self.gpu_enabled:
                        self.gpu, self.gpu_status = gpu, 'NVIDIA driver • sampled every 10 seconds'
            except Exception as exc:
                with self.lock:
                    if self.gpu_enabled:
                        self.gpu = None
                        self.gpu_status = str(exc)
            self._wait_for_activity(self.gpu_wake, 10)

    def set_gpu_enabled(self, enabled):
        with self.lock:
            self.gpu_enabled = enabled
            self.gpu = None
            self.gpu_status = 'Waiting for next NVIDIA sample' if enabled else 'GPU polling off. Enable it here to read NVIDIA sensors.'
            self.gpu_wake.set()
            self.sample_wake.set()

    def set_interval(self, seconds):
        if type(seconds) not in (int, float) or seconds not in (1, 2, 5):
            raise ValueError('Refresh interval must be 1, 2 or 5 seconds')
        with self.lock:
            self.interval = seconds
            self.sample_wake.set()

    def _sample_loop(self):
        psutil.cpu_percent(interval=None)
        self.stop.wait(0.3)
        sampled_generation = 0
        while not self.stop.is_set():
            if not self._wait_for_activity(self.sample_wake):
                break
            with self.lock:
                generation = self.activity_generation
            if generation != sampled_generation:
                self.process_sampler.previous.clear()
                sampled_generation = generation
            begin = time.monotonic()
            try:
                data = self.sample()
                data['collectionMs'] = round((time.monotonic() - begin) * 1000, 1)
                with self.lock:
                    if not self.active or generation != self.activity_generation:
                        self.process_sampler.previous.clear()
                        continue
                    self.current = data
                    self.samples.append({**{k: data[k] for k in ('timestamp', 'cpu', 'memoryPercent', 'diskRead', 'diskWrite', 'netDown', 'netUp')}, 'performance': graph_sample(data['performance'])})
                    while self.samples and self.samples[0]['timestamp'] < data['timestamp'] - 3600:
                        self.samples.popleft()
                    self.error = None
            except Exception as exc:
                with self.lock:
                    self.error = str(exc)
            # Recheck the selected cadence while waiting, including slow → fast.
            with self.lock:
                interval = self.interval
            remaining = max(0, interval - (time.monotonic() - begin))
            self._wait_for_activity(self.sample_wake, remaining)
        self.performance_sampler.close()

    def sample(self):
        cpu = psutil.cpu_percent(interval=None)
        memory = psutil.virtual_memory()
        disk, net = psutil.disk_io_counters(), psutil.net_io_counters()
        now = time.monotonic()
        counters = (getattr(disk, 'read_bytes', 0), getattr(disk, 'write_bytes', 0), net.bytes_recv, net.bytes_sent)
        rates = [None] * 4
        if self.previous_io:
            old_time, old = self.previous_io
            rates = [round(max(0, a - b) / max(.001, now - old_time), 1) for a, b in zip(counters, old)]
        self.previous_io = now, counters
        volumes = []
        seen = set()
        for p in psutil.disk_partitions(all=False):
            if p.mountpoint in seen or 'cdrom' in p.opts or not p.fstype:
                continue
            seen.add(p.mountpoint)
            try:
                usage = psutil.disk_usage(p.mountpoint)
                volumes.append({'mount': p.mountpoint, 'total': usage.total, 'free': usage.free, 'percent': usage.percent})
            except OSError:
                continue
        with self.lock:
            processes_enabled = self.processes_enabled
            process_interval = self.processes_interval
            process_generation = self.process_generation
            process_due = processes_enabled and (
                not self.processes_rows or now - self.processes_last_at >= process_interval)
            rows, skipped = self.processes_rows, self.processes_skipped
        if process_due:
            sampled_rows, sampled_skipped = self.process_sampler.sample()
            with self.lock:
                if self.processes_enabled and self.process_generation == process_generation:
                    rows, skipped = sampled_rows, sampled_skipped
                    self.processes_rows = rows
                    self.processes_skipped = skipped
                    self.processes_last_at = now
                    self.process_generation += 1
                else:
                    self.process_sampler.previous.clear()
                    rows, skipped = [], 0
        elif not processes_enabled:
            self.process_sampler.previous.clear()
            rows, skipped = [], 0
        battery = psutil.sensors_battery()
        battery_data = None
        if battery:
            battery_data = {'percent': battery.percent, 'plugged': battery.power_plugged,
                            'secondsLeft': battery.secsleft if battery.secsleft >= 0 else None}
        with self.lock:
            gpu = dict(self.gpu) if self.gpu else None
            hardware = self.hardware
        performance = self.performance_sampler.sample(cpu, memory, hardware, gpu)
        return {'timestamp': time.time(), 'cpu': cpu,
                'performance': performance,
                'memory': {'percent': memory.percent, 'used': memory.total - memory.available,
                           'available': memory.available, 'total': memory.total},
                'memoryPercent': memory.percent, 'diskRead': rates[0] if disk else None,
                'diskWrite': rates[1] if disk else None, 'netDown': rates[2], 'netUp': rates[3],
                'battery': battery_data, 'volumes': volumes, 'processes': rows, 'processesSkipped': skipped,
                'gpu': gpu, 'uptimeSeconds': time.time() - psutil.boot_time()}

    def snapshot(self, history_since=None, process_since=None):
        with self.lock:
            current = self.current
            if current is not None:
                current = dict(current)
                if process_since is not None and process_since == self.process_generation:
                    current.pop('processes', None)
                    current.pop('processesSkipped', None)
            if history_since is None or not self.samples or history_since < self.samples[0]['timestamp']:
                history = list(self.samples)
                history_key = 'history'
            else:
                history = [sample for sample in self.samples if sample['timestamp'] > history_since]
                history_key = 'historyDelta'
            recent = []
            cutoff = current['timestamp'] - 60 if current else 0
            for sample in reversed(self.samples):
                if sample['timestamp'] < cutoff:
                    break
                recent.append(sample)
            recent.reverse()
            result = {'app': 'Laptop Lens', 'current': current, history_key: history, 'hardware': self.hardware,
                      'gpuStatus': self.gpu_status, 'gpuEnabled': self.gpu_enabled, 'error': self.error,
                      'startedAt': self.started, 'intervalSeconds': self.interval,
                      'processGeneration': self.process_generation}
        result['insights'] = insights(recent, current) if current else []
        return result
