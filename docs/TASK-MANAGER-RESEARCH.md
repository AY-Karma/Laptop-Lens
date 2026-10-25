# Task Manager Performance API research

Researched 2026-10-25 for Laptop Lens. Read-only research; no implementation or Windows settings changed. Sources are Microsoft contracts and upstream library source. Recommendations below distinguish useful approximations from documented Task Manager equivalence.

## Memory: recommended backend mappings

Call `GetPerformanceInfo` once per sample, through `Psapi.dll!GetPerformanceInfo` or `Kernel32.dll!K32GetPerformanceInfo`. Define the complete `PERFORMANCE_INFORMATION` structure with native alignment: `DWORD cb`, ten `SIZE_T` fields from `CommitTotal` through `PageSize`, then three `DWORD` counts. In Python use `ctypes.c_size_t`, not fixed-width 32-bit integers, for `SIZE_T`; set `cb` and pass `sizeof(structure)`. Check BOOL success before consuming output. [GetPerformanceInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getperformanceinfo), [structure](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information).

All memory amounts in this structure are **pages**, except `PageSize`, which is bytes. Multiply using full-width integers:

- `committedBytes = CommitTotal * PageSize`; `commitLimitBytes = CommitLimit * PageSize`. Commit is allocated backing commitment, not physical RAM consumption or bytes actually written to pagefiles. The limit can grow with pagefile expansion.
- `usableBytes = PhysicalTotal * PageSize`; `availableBytes = PhysicalAvailable * PageSize`. Available includes standby, free and zero pages that can be reused without first writing their contents to disk.
- `systemCacheBytes = SystemCache * PageSize`. Label this **System cache**; the structure describes standby plus the system working set.
- `pagedPoolBytes = KernelPaged * PageSize`; `nonpagedPoolBytes = KernelNonpaged * PageSize`; `kernelPoolBytes = KernelTotal * PageSize`.
- `HandleCount`, `ProcessCount`, `ThreadCount` are counts; do not multiply them.

These are direct mappings from the [PERFORMANCE_INFORMATION field definitions](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information).

**Cache caveat:** `SystemCache` is not a documented exact mapping to today's Task Manager **Cached** label. Microsoft's historical Task Manager mapping distinguishes it from cached memory calculated using cache/standby/modified-list counters. If matching the reclaimable Cached figure, collect standby reserve + normal + core bytes and modified-list bytes as a separately named measure, and compare on the target build. Do not add cache to available or used as if categories were disjoint. The historical mapping page calls one standby counter “Code”; enumerate the actual provider (this machine exposes **Core**). [Microsoft memory counter mappings](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information).

`usedBytes = usableBytes - availableBytes` is a useful explicitly defined **Used physical memory** figure. Do not promise exact Task Manager **In use (Compressed)** parity; modified pages and display accounting can make the figures differ. Likewise, `MEMORYSTATUSEX.ullTotalPageFile` is a commit limit, potentially restricted to the calling process, not pagefile size; prefer the system-wide `CommitLimit` above. [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex).

### psutil Windows semantics, pinned version 7.2.2

The repository and installed environment both specify psutil 7.2.2. Its C implementation calls **GetPerformanceInfo**, not GlobalMemoryStatusEx, and returns physical total/available and system commit limit/headroom. Its Python wrapper exposes:

```text
virtual_memory().total     = PhysicalTotal * PageSize
virtual_memory().available = PhysicalAvailable * PageSize
virtual_memory().free      = available
virtual_memory().used      = total - available
virtual_memory().percent   = round(100 * (total - available) / total, 1)
```

Thus **free equals available on Windows** and includes reclaimable standby pages. Do not label it free-and-zero memory. `virtual_memory()` does not expose commit, pools, cache or compression. `swap_memory()` is not a substitute for committed/limit. [Versioned C source](https://github.com/giampaolo/psutil/blob/release-7.2.2/psutil/arch/windows/mem.c), [versioned Python wrapper](https://github.com/giampaolo/psutil/blob/release-7.2.2/psutil/_pswindows.py).

### Installed RAM and hardware reserved

Use `GetPhysicallyInstalledSystemMemory(ULONGLONG*)` for installed RAM from SMBIOS; its result is **kilobytes**, so multiply by 1024. Use `GlobalMemoryStatusEx().ullTotalPhys` for OS-usable physical RAM. Recommended derivation: `hardwareReservedBytes = installedBytes - usableBytes`, only when both calls succeed and the result is nonnegative. Report null if installed-memory retrieval fails; never silently substitute usable memory and claim zero hardware reserved. Microsoft explains that BIOS/device reservations cause the difference and rejects malformed SMBIOS totals smaller than usable RAM. This difference measures unavailable installed RAM; it does not identify which device owns each byte. [Installed-memory API and remarks](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getphysicallyinstalledsystemmemory).

### Compression: optional, unavailable by default

Neither `PERFORMANCE_INFORMATION`, `MEMORYSTATUSEX` nor this psutil API provides compressed-store size. Do not estimate it from System working set, commit minus physical usage, a process name, a compression-enabled boolean, or a fixed percentage. The public `NtQuerySystemInformation` contract warns of future changes and does not document a stable compressed-store byte getter. Recommendation: `compressedBytes: null`, with a reason; display “Unavailable” or omit the parenthetical compressed figure. A genuine measured zero must remain distinguishable from missing data. [Public native-system-information contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation).

Local read-only `Get-Counter -ListSet Memory` enumeration found cache/standby/modified counters but **no compression-named counter**. Therefore do not hardcode `\Memory\Compressed Page Size` as a universally available Windows counter. A future optional provider needs documented units/meaning, runtime capability checks and validation against the target Windows build before exposing bytes. No compression settings were changed.

## Per-disk active time, latency and throughput

Maintain a long-lived native PDH query on the telemetry worker. Add these English counter paths, with one actual instance per OS-visible disk:

```text
\PhysicalDisk(*)\% Idle Time
\PhysicalDisk(*)\Avg. Disk sec/Transfer
\PhysicalDisk(*)\Disk Read Bytes/sec
\PhysicalDisk(*)\Disk Write Bytes/sec
```

Recommended mappings:

- `activePercent = 100 - idlePercent` for a validated sample; bound the display to 0–100, retaining an invalid status for implausible provider output. Idle measures elapsed idle fraction; the complement measures busy fraction. Do not derive active time from throughput, capacity usage, queue length, or summed concurrent read/write durations.
- `responseMs = formattedAvgDiskSecPerTransfer * 1000`. This is average transfer latency over the interval. Keep PDH output as `DOUBLE`; integer-second conversion loses normal SSD latency.
- `readBytesPerSecond`, `writeBytesPerSecond` come directly from formatted byte-rate counters.

The provider defines idle fraction and transfer latency; the complement and conversion above are implementation derivations. An exact Task Manager internal formula is not publicly guaranteed here. [PhysicalDisk counter definitions](https://learn.microsoft.com/en-us/previous-versions/aa394308(v=vs.85)), [Microsoft drive latency/throughput mapping](https://learn.microsoft.com/en-us/windows-server/storage/storage-spaces/performance-history-for-drives).

**PDH lifecycle and localization:**

1. `PdhOpenQueryW`; `PdhAddEnglishCounterW` accepts English object/counter names on localized Windows. `PdhAddCounterW` requires localized names.
2. For wildcards follow Microsoft's explicit procedure: add the English wildcard counter, call `PdhGetCounterInfoW` to obtain the localized `szFullPath`, expand that through `PdhExpandWildCardPathW`, then add each resulting path with `PdhAddCounterW`. Do not enumerate localized names and compare them to literal English object names. [Documented localization procedure](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhaddenglishcounterw).
3. Parse full paths with `PdhParseCounterPathW`; retain the actual instance name and instance index rather than splitting arbitrary path text. Localized counter names and disk identity are separate concerns. [Path parser](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhparsecounterpathw).
4. Collect once to establish a baseline, then collect on the existing interval and format with `PDH_FMT_DOUBLE`. Check both the API return and `CStatus` (`VALID_DATA`/`NEW_DATA`). Initial, missing-instance and failed readings are null, not fabricated zero. Re-enumerate on device changes; close query handles at shutdown. [Formatting, baseline requirements and missing-instance behavior](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcountervalue).

**Identity:** local instances observed were `0 C:`, `1 D:` and `_Total`. Exclude aggregate instances from per-disk cards. In the conventional provider, the numeric prefix is a useful mapping candidate to an OS disk number; this naming convention is not a universal storage-topology identity contract. Verify it against enumerated OS disks (`Win32_DiskDrive.Index`/`Get-Disk.Number` or a device handle queried with `IOCTL_STORAGE_GET_DEVICE_NUMBER`); retain unknown instances separately if mapping is ambiguous. Do not equate a Storage Spaces `Get-PhysicalDisk.DeviceId` with an OS disk number without verification. Native device numbers themselves are not persistent across restart/removal. [Storage device-number query](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_storage_get_device_number), [identity lifetime](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ns-winioctl-storage_device_number).

Map volume letters via `IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS` when needed: one volume may span multiple disks, and one disk can hold multiple volumes. An OS-visible RAID/virtual disk is not necessarily an individual underlying physical drive. Do not clone one aggregate sample onto every card. [Volume disk extents](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-ioctl_volume_get_volume_disk_extents).

If counters are disabled or inaccessible, return unavailable with diagnostic status. This task does not authorize enabling counters or changing disk settings.

## Per-interface network throughput and link speed

Simple existing dependency route: use `psutil.net_io_counters(pernic=True)` and delta `bytes_sent`/`bytes_recv` by interface over **monotonic elapsed seconds**. In 7.2.2 these counters come from `GetIfEntry2` `OutOctets`/`InOctets`, named using adapter FriendlyName. Keep interfaces separate; aggregating VPN and physical adapter traffic can count the same logical transfer twice. [Pinned native implementation](https://github.com/giampaolo/psutil/blob/release-7.2.2/psutil/arch/windows/net.c).

Preferred native route for identity and accurate speed: `Iphlpapi.dll!GetIfTable2`, or `GetIfEntry2` for known adapters, provides `MIB_IF_ROW2`:

- `InOctets`, `OutOctets`: cumulative 64-bit received/sent bytes; `receiveBps = 8 * ΔInOctets / Δseconds`, `sendBps = 8 * ΔOutOctets / Δseconds`.
- `ReceiveLinkSpeed`, `TransmitLinkSpeed`: 64-bit link speeds in **bits/sec**, separate from observed throughput. A negotiated link speed is not measured internet capacity.
- `InterfaceGuid` for stored identity, LUID for runtime association; index may change on disable/re-enable. Alias/Description are display strings. Use OperStatus and interface flags/type to expose physical/virtual/offline status.

These fields and units are documented in [MIB_IF_ROW2](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/ns-netioapi-mib_if_row2). The rate formula and reset policy are application recommendations: baseline on first sight, disappearance, counter decrease, reconnect or identity change; do not emit negative throughput or a reconnect spike. Unknown speed stays null. Free native tables with `FreeMibTable` and honor structure/array alignment, including padding after the count. [GetIfTable2 allocation and padding](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-getiftable2).

**Pinned psutil speed limitation:** its `net_if_stats()` still uses old `MIB_IFROW.dwSpeed / 1_000_000` and hardcodes full duplex. Do not treat that duplex result as measured; prefer ROW2 link speed for fast adapters and asymmetric Wi-Fi speeds. [7.2.2 source](https://github.com/giampaolo/psutil/blob/release-7.2.2/psutil/arch/windows/net.c).

## Native executable icons and safe PNG output

Use the resolved process executable path as a cache key (plus modification time/size for invalidation), with a generic fallback when access is denied or the process exits. Proposed extraction worker:

1. Initialize COM on the worker thread. Call `Shell32.dll!SHGetFileInfoW(path, 0, &info, sizeof(info), SHGFI_ICON | SHGFI_SMALLICON)` or large-icon variant. Use the actual file path without `SHGFI_USEFILEATTRIBUTES`, which requests file-type behavior instead of accessing the executable. The return type is pointer-sized `DWORD_PTR`; `hIcon` is pointer-sized. Do not truncate handles on x64. Shell extraction belongs off the live/UI path. [SHGetFileInfoW contract](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetfileinfow).
2. Alternative for embedded executable resources: `ExtractIconExW(path, 0, ...)`. Free every returned icon with `DestroyIcon`, including unused small/large results. [ExtractIconExW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-extracticonexw).
3. Convert the owned icon to a real encoded image while the handle is valid, then release it in `finally`. If using an ICO intermediate, serialize a complete valid ICO (for example, Windows `System.Drawing.Icon.FromHandle(hicon).Save(stream)`), rather than treating an `HICON`, an isolated DIB or raw BGRA bytes as PNG. The managed wrapper does not remove the native cleanup requirement. [FromHandle](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.icon.fromhandle), [Icon.Save](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.icon.save).
4. For Python conversion, add an explicit Pillow dependency if absent: open the complete ICO from bounded bytes, choose a supported size, fully `load()`, convert to `RGBA`, then `save(..., format="PNG")`. Catch decoder/size failures and use the generic icon. ICO may contain BMP or PNG payloads; do not rename the file or return ICO bytes with `image/png`. Pillow supports ICO decoding and chooses the largest available image by default. [Pillow ICO contract](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#ico), [decoder source](https://github.com/python-pillow/Pillow/blob/main/src/PIL/IcoImagePlugin.py).

An all-native raster route can draw through `DrawIconEx(DI_NORMAL)` into a bounded bitmap and encode PNG. Respect alpha/mask behavior: Microsoft specifies alpha blending for 32-bit alpha icons and AND/XOR masking for others. If using `GetIconInfo`, delete both returned bitmap handles with `DeleteObject`; destroy the original owned HICON separately. Do not ignore the mask and produce opaque black backgrounds. [DrawIconEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-drawiconex), [GetIconInfo ownership](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-geticoninfo).

Recommendations: bound icon dimensions and cache size; cache misses briefly; request only icons needed for visible rows; serve an opaque cache ID or PNG data URL rather than exposing arbitrary client-supplied filesystem paths. No executable is launched for extraction. An executable icon can differ from a packaged app's current window/taskbar identity; do not claim universal Task Manager icon parity.

## CPU busy time, frequency and Task Manager versions

`GetSystemTimes` gives cumulative kernel/user/idle time. Kernel includes idle. Across valid samples:

```text
totalDelta = deltaKernel + deltaUser
busyPercent = 100 * (totalDelta - deltaIdle) / totalDelta
```

Use null for first/nonpositive intervals. Above 64 logical processors, the API is limited to the calling thread's primary processor group, so it needs a group-aware alternative. [GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes).

Historically Windows 8 Task Manager switched to `\Processor Information(_Total)\% Processor Utility`, which incorporates performance state relative to nominal performance. Busy-time percentage instead measures occupied time. Utility can exceed 100 under turbo; if exposing it, keep it separate and use `PDH_FMT_DOUBLE | PDH_FMT_NOCAP100`. Do not derive a purported native utility value by multiplying busy percentage by one sampled clock ratio. [Microsoft explanation](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/cpu-usage-exceeds-100), [PDH formatting flags](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhgetformattedcountervalue).

**Current Windows caveat:** KB5053656 (March 27, 2025, build 26100.3624 preview) announced standardized CPU workload metrics across Processes, Performance and Users under gradual rollout; the previous value remains an optional Details **CPU Utility** column. Windows 11 25H2 documentation confirms the revised behavior. These releases do not publish an exact replacement API/formula. Therefore label the app's metric **CPU busy** or document its formula, and avoid promising exact parity with every Task Manager build. [KB5053656](https://support.microsoft.com/en-us/help/5053656), [Windows 11 25H2 changes](https://learn.microsoft.com/en-us/windows/whats-new/whats-new-windows-11-version-25h2).

`CallNtPowerInformation(ProcessorInformation)` returns `PROCESSOR_POWER_INFORMATION`: `MaxMhz` is maximum specified clock; `CurrentMhz` is documented as maximum specified clock multiplied by current throttle; `MhzLimit` is the thermal throttle limit. Keep speed separate from busy/utility; this API does not promise hardware-measured effective frequency or Task Manager Speed equality. [Processor power information](https://learn.microsoft.com/en-us/windows/win32/power/processor-power-information-str).

## Official Run dialog route

Verified: instantiate COM ProgID `Shell.Application` and call parameterless `FileRun()`. Microsoft explicitly documents that this displays the Windows Run dialog. The equivalent Windows PowerShell invocation is:

```powershell
(New-Object -ComObject Shell.Application).FileRun()
```

It accepts no command argument and returns no value. Backend success means the invocation completed, not that the user launched an application. Run in the interactive user's desktop context; do not use undocumented shell ordinals as the main route. This command was **not executed** during research. [Official Shell.FileRun documentation](https://learn.microsoft.com/en-us/windows/win32/shell/shell-filerun).

## Implementation handoff

- One fast memory snapshot, persistent PDH sampling, per-interface deltas and asynchronous cached icon extraction fit the current telemetry worker model.
- Include source/status and sampling timestamps. Null means unavailable/warming up; zero is a measured idle/empty value. Separate stale previous data from current readings.
- Validate one normal-user run against local Task Manager with comparable sampling windows; test reconnect/hotplug and localized counter discovery. Compare labels and definitions before assuming a numeric mismatch is a bug.
- Deliver compression as optional unavailable until there is a verified provider. Keep System cache distinct from Task Manager Cached, CPU busy distinct from utility, and link speed distinct from throughput.

Local evidence was limited to reading project files/pinned psutil and enumerating existing Memory/PhysicalDisk counter paths. No benchmark load, Run-dialog invocation, counter enablement, registry, service or system-setting changes were performed.
