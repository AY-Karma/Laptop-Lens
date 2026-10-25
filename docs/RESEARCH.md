# Lenovo Vantage and a local read-only dashboard

Research date: 2026-10-24. Primary sources only: Lenovo documentation, product specifications, security advisories and privacy documentation; Microsoft API and Windows documentation. This is desk research, not a hardware compatibility test. No software was uninstalled, services stopped, firmware changed, or implementation files edited.

## Findings and recommended boundary

A useful no-subscription dashboard can display Windows-reported system inventory, utilization, battery status and available disk reliability data. It should be presented as a local telemetry viewer, not a replacement for every Vantage feature, a hardware diagnostic certification, or a firmware controller. The recommendation below is an engineering inference from the documented interfaces and their limitations.

## 1. Vantage features versus paid services

The user guide applicable to this Legion generation describes Vantage as a free Microsoft Store download for product information/system status, device settings and system updates. It explicitly warns that features change with updates and are not available on every Lenovo product. [Lenovo Legion Gen 6 guide: Vantage](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/intro_vantage_pc_manager.html)

Lenovo separately documents hardware diagnostics, system health, warranty status and support material among Vantage's functions. Hardware Scan is intended to diagnose hardware failures. It should not be confused with the commercial Smart Performance scan. [Lenovo system and diagnostic tools, HT505232](https://support.lenovo.com/lk/en/solutions/ht505232)

Smart Performance is a paid maintenance/optimization service surfaced inside Vantage. Lenovo offers a free scan, then an in-app purchase; its product page invites annual subscription enrollment. Its support material also describes subscription and fixed-term licenses and subscriber scan/fix functionality. A free scan does not establish that all suggested fixes are free. [Lenovo Smart Performance product page](https://www.lenovo.com/us/en/software/lenovo-smart-performance-services/), [Smart Performance support, HT509246](https://support.lenovo.com/vc/en/solutions/ht509246-vantage-smart-performance)

Lenovo's product privacy statement lists compatible accessories, other applications, and offers for Lenovo or third-party products/services among Vantage experiences. That is evidence of promotional content, not evidence that every hardware setting requires payment. [Lenovo privacy statement, 2024 version](https://www.lenovo.com/ca/en/privacy/2024/)

**Implication:** keep optional software-service subscriptions, warranty/support entitlements, and installed hardware-support components conceptually separate. Do not call an installed Lenovo service a paid subscription merely because its name contains “service.” No purchase or subscription is necessary for the Microsoft telemetry interfaces described below. Do not reproduce Lenovo marketing claims about speed improvements as measured facts about this computer.

## 2. System Interface Foundation and ImController architecture

Lenovo describes System Interface Foundation (SIF) as services, drivers and plugins supporting Vantage. This documents a dependency layer beyond the visible app. The cited page concerns removal, but was consulted only as architecture documentation; its procedures were not executed. [Lenovo SIF documentation, HT506070](https://pcsupport.lenovo.com/us/en/products/laptops-and-netbooks/legion-series/legion-5-pro-16ach6/solutions/ht506070-how-to-uninstall-lenovo-system-interface-foundation-windows-10-thinkpad-thinkcentre-ideapad-ideacentre)

Lenovo's security advisory identifies IMController as a SIF component, describes a child process and named-pipe communication, and documents automatic IMController updates through the SIF service. This establishes that ImController is not simply another name for the Vantage UI. It does not establish a supported public API for third-party applications. [Lenovo advisory LEN-75210](https://support.lenovo.com/gy/en/solutions/LEN-75210)

A subsequent advisory distinguishes HardwareScan/SystemUpdate **plugins** updated by SIF from the HardwareScan **Addin** updated by Lenovo Vantage Service. Consequently, Vantage Service and SIF/ImController should not be treated as interchangeable names or assumed to have identical dependencies. [Lenovo advisory LEN-94532 / PS500532](https://support.lenovo.com/gn/zc/product_security/ps500532-lenovo-vantage-component-vulnerabilities)

The SIF download explicitly describes dependencies for Vantage 4.0 and Settings for Enterprise 4.10. Those are version-specific statements, not a complete dependency matrix for a current 82JU installation. [Lenovo SIF package DS105970](https://support.lenovo.com/np/en/downloads/ds105970)

**Limits:** historical advisories explain architecture but do not prove the installed components are vulnerable today. This research did not establish which installed service supplies each hotkey, charging setting, thermal feature or on-screen indicator on the actual laptop. A telemetry dashboard should neither disable these components nor use private named pipes/plugin internals. Removing the app and removing hardware-support services are different changes; neither is required for a Windows-only viewer.

## 3. Legion machine type 82JU

Lenovo's applicable-model table identifies **82JU as Legion 5 15ACH6H / Lenovo Legion 5 15ACH6H**. It belongs to the 15-inch Gen 6 guide family. [Lenovo applicable-model table](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/ug_notice.html)

82JU identifies the machine type, not the complete configuration. Lenovo PSREF lists many full 82JU model codes with differing configurations. Do not infer the installed CPU, GPU, display, RAM, SSD or battery capacity from those four characters alone. Read the actual machine and, where needed, resolve its full model code against PSREF. [Lenovo 15ACH6H model catalog](https://psref.lenovo.com/WDProduct/Legion/Legion_5_15ACH6H?tab=model)

The exact-generation guide documents Fn+Q for cycling performance modes and says Performance mode is unavailable on battery power. It also maps the power light to Balance (white), Performance (red) and Quiet (blue). These are documented user controls/indicators, not a documented programmatic control API. [Performance modes](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/performance_mode.html), [Power light meanings](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/view_base_legion5.html)

Do not import a conservation-mode percentage, custom fan feature or GPU switching behavior from a newer Legion guide into this model. This investigation did not verify a model/firmware-specific public API for reading those states.

## 4. Supported Windows telemetry

### Battery and AC power

`Get-CimInstance` retrieves CIM instances and defaults to the local computer without a remote session. It is suitable for querying `Win32_Battery` in `root/cimv2`. [Microsoft Get-CimInstance](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-7.5)

`Win32_Battery` exposes estimated charge percentage, battery status, estimated runtime and optional design/full-charge capacities. Capacities are documented in mWh; unsupported capacities may be zero. Estimated runtime is an estimate, not a guaranteed time remaining. Do not calculate battery health when either capacity is absent, zero or invalid. Do not interpret the status value “Unknown” as a failure. [Microsoft Win32_Battery](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-battery)

For AC connection and aggregate battery status, Windows provides `GetSystemPowerStatus` / `SYSTEM_POWER_STATUS`. The documented unknown values include AC status 255, battery percentage 255, and lifetime -1. Preserve those as unknown. [Microsoft SYSTEM_POWER_STATUS](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-system_power_status)

If detailed battery health is a later requirement, Microsoft's battery device interface documents designed/full-charged capacity and cycle count. Capacity can be relative rather than mWh; cycle count zero can mean unsupported. This is an alternative documented interface, not evidence that all of those values will appear in CIM on this laptop. [Microsoft BATTERY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/power/battery-information-str)

Windows can generate a local battery usage/capacity report with `powercfg /batteryreport`, including XML output. Treat it as an explicit export action that writes a file, rather than a continuously polled live sensor or a firmware modification. [Microsoft powercfg options](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options)

**Recommended presentation:** charge percentage and charging/AC state first; optional capacities and an explicitly labeled full-charge/design-capacity estimate only with valid comparable inputs. Never show missing capacity as 0% health or an unsupported cycle count as “new battery.”

### CPU, memory, disk and GPU utilization

Windows exposes performance counters through PDH and PowerShell `Get-Counter`. Counter names are localized, and some sets have ACL restrictions. Discover available counters/classes and show permission or availability errors instead of requiring permanent administrator access. [Microsoft Get-Counter](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-counter?view=powershell-7.6)

WmiPerfInst supplies raw/formatted counter data to WMI performance classes and bridges them to PDH. It supersedes the old Cooked Counter provider. A CIM-based collector may use available `Win32_PerfFormattedData_*` classes; discover them rather than treating all properties as a universal fixed contract. [Microsoft WmiPerfInst](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmiperfinst-provider), [Formatted performance classes and dynamic availability](https://learn.microsoft.com/en-us/windows/win32/wmisdk/formatted-performance-data-provider)

Many rate counters require two samples. Total processor usage is an average across processors, while a process CPU counter can exceed 100% by aggregating multiple processors. A collector must apply the relevant counter's semantics before labeling values as percentages. [Microsoft collecting performance data](https://learn.microsoft.com/en-us/windows/win32/perfctrs/collecting-performance-data)

GPU utilization is optional. Microsoft's GPU telemetry explanation requires a WDDM 2.0-or-newer driver for Task Manager GPU data and explains that its overall usage uses the busiest engine. Summing all engine percentages would not recreate that meaning. This source does not guarantee every GPU counter exists on every installation. [Microsoft DirectX: GPUs in Task Manager](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/)

**Recommended initial metrics:** CPU total utilization, memory used/available, volume capacity/free space, and available disk read/write rates. Add optional GPU engine utilization with clear adapter/engine labels after runtime detection. Record sample time and staleness; pause or slow collection when the dashboard is not visible.

### Storage reliability

`Get-StorageReliabilityCounter` obtains supported counters for a disk or physical disk. It documents device temperature, errors, wear and time in use. It is a query, not a repair operation. [Microsoft Get-StorageReliabilityCounter](https://learn.microsoft.com/en-us/powershell/module/storage/get-storagereliabilitycounter?view=windowsserver2025-ps)

`MSFT_StorageReliabilityCounter` lives in `root/Microsoft/Windows/Storage` and exposes read-only properties such as temperature (Celsius), power-on hours, error counts and wear. Wear is percentage **used**: 100 means the estimated wear limit is reached. It is not automatically “health remaining.” The class also has a Reset method; a read-only collector must never invoke it. [Microsoft storage reliability class](https://learn.microsoft.com/en-us/windows-hardware/drivers/storage/msft-storagereliabilitycounter)

**Recommended presentation:** optional per-physical-device values with the device identity, source and timestamp. Availability must be verified against the actual storage driver/device. Do not promise complete NVMe SMART coverage or translate missing counters into a clean bill of health. Volume free space, utilization and physical-device reliability are different measurements.

### Temperature and fans

Windows' thermal architecture uses abstract ACPI thermal zones whose reported temperature can be a physical reading or an extrapolation from several sensors. Windows also acknowledges proprietary fan-control implementations. A thermal-zone value must therefore not be labeled CPU package temperature or GPU junction temperature without verified sensor mapping. [Microsoft thermal design guide](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/design-guide)

**Limit:** this research establishes no universally available CPU/GPU temperature or fan RPM source for 82JU using only standard CIM queries. Omit these metrics or mark them unavailable in the initial dashboard. Do not install a kernel driver or probe the embedded controller merely to fill a missing card.

## 5. Safe limits for firmware and Lenovo-specific controls

Lenovo's documented BIOS WMI deployment guide explicitly applies to ThinkPad systems; its supported-model list is not evidence of Legion support. Do not assume `Lenovo_SetBiosSetting`, password methods or a ThinkPad battery-threshold interface works on 82JU. [Lenovo BIOS WMI scope, HT100612](https://support.lenovo.com/am/th/solutions/ht100612)

**Recommended scope decision:** exclude EC/ACPI writes, undocumented WMI method calls, fan curves, overclocking/undervolting, CPU/GPU power limits, conservation/rapid-charge toggles, thermal-mode switching, MUX/hybrid graphics changes, BIOS flashing, registry tweaks and service control. Availability of such controls in Vantage's UI does not supply a public third-party API contract. Link to Lenovo's documented UI/hotkeys for a person to use if needed.

Keep Windows power-plan labels separate from Lenovo firmware performance modes. Do not infer a firmware mode from the currently selected Windows plan, CPU load, fan noise or power-light documentation alone. A read-only mode display would need a verified model-specific read interface and real-machine validation first.

## 6. Proposed no-subscription dashboard scope

The following are design recommendations, not Lenovo product claims:

- Local inventory and live Windows telemetry only; no Lenovo account, subscription, remote telemetry upload, optimizer, cleaner or paid scan flow.
- Prefer an ordinary-user collector with a fixed allowlist of query operations. Do not expose arbitrary shell execution or CIM method invocation through the UI/API.
- If implemented as a browser UI, use a small local backend: web content alone does not provide the Windows CIM/PDH data described here. Bind to loopback and protect local endpoints from cross-origin requests. Avoid a privileged always-running service for the initial version.
- Show source, units, observation time and availability for each metric. Distinguish unsupported, permission denied, collection error and stale values. Preserve genuine numeric zeros when the source defines them; do not globally replace zero with unknown.
- Keep short history in memory by default. Make report/history exports explicit and avoid serial numbers or other identifiers in ordinary logs.
- Use modest polling and query timeouts; avoid stressing the laptop or repeatedly waking a discrete GPU for optional metrics. Choose intervals through actual overhead measurements.
- Leave installed Lenovo software and its update behavior untouched. The viewer can coexist with Vantage without claiming to replace hardware configuration, firmware updates, warranty services or official diagnostics.

## 7. What remains unverified

No live queries were run against the intended 82JU hardware. The exact full model code, battery configuration, installed Windows build, counter/provider availability, privilege requirements, storage-driver passthrough, sensor mappings and Lenovo component versions remain untested. These must be capability-detected during a separately authorized implementation/validation task.

Some Lenovo regional support pages returned only a navigation shell when opened, while their primary-source search results exposed article text. Relevant architectural claims were cross-checked against Lenovo advisories/package descriptions where possible. This report does not rely on community reverse engineering or secondary tutorials. Smart Performance pricing and eligibility vary by region/version; no price or universal Commercial Vantage eligibility is asserted. No public, supported Legion-specific firmware-control API was established by this search; that is a research limitation, not proof that no interface exists.
