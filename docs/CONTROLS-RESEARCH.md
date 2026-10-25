# Laptop Lens controls research: Legion 5 15ACH6H (82JU)

Research date: 2026-10-25. Primary sources only: Microsoft and Lenovo documentation, the installed Lenovo-signed package manifest, and LenovoLegionToolkit (LLT) source. No settings were written, apps launched, firmware methods invoked, services changed, or serial numbers collected/transmitted. Only this document is added to the workspace. Source inspection used a separate temporary clone.

## Decision and evidence boundary

Ship the Windows navigation shortcuts and an installed-Vantage launcher independently of hardware controls. Firmware controls need per-interface discovery, validated reads, and explicit user actions. A model name or a missing method is insufficient to infer a state. Distinguish unsupported, access denied, unknown value, and a temporary provider failure.

Lenovo identifies 82JU as Legion 5 15ACH6H in its [applicable-model table](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/ug_notice.html). The generation guide documents Fn+Q performance modes and excludes Performance mode on battery: [Lenovo performance modes](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/performance_mode.html). This is not a public firmware programming contract.

LLT is a primary source for its own implementation, **not an official Lenovo SDK**. All LLT citations below are pinned to upstream commit `63c173024495bae37283e247f11953a09f79ba11`. The original project is archived; its [README](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/README.md) names Lenovo Energy Management and Vantage Gaming Feature Driver as important dependencies. Presence of either driver does not guarantee every feature. These mappings remain untested against this machine's firmware. Do not substitute ThinkPad `Lenovo_BiosSetting`/`Lenovo_SetBiosSetting`/`Lenovo_SaveBiosSettings` APIs for the interfaces below.

## Windows navigation: exact allowlisted URIs

All entries in this table are documented by [Microsoft's Settings URI reference](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings). These navigate to UI; they do not expose current settings to Laptop Lens.

| Action | URI |
| --- | --- |
| Windows Update | `ms-settings:windowsupdate` |
| Optional updates | `ms-settings:windowsupdate-optionalupdates` |
| Update history | `ms-settings:windowsupdate-history` |
| Update advanced options | `ms-settings:windowsupdate-options` |
| Recovery | `ms-settings:recovery` |
| Touchpad | `ms-settings:devices-touchpad` |
| Camera devices/settings | `ms-settings:camera` |
| Camera access/privacy | `ms-settings:privacy-webcam` |
| Display | `ms-settings:display` |
| Graphics preferences | `ms-settings:display-advancedgraphics` |
| Personalization | `ms-settings:personalization` |
| Background / colors / themes | `ms-settings:personalization-background` / `ms-settings:personalization-colors` / `ms-settings:themes` |
| Windows Security settings | `ms-settings:windowsdefender` |
| Network overview | `ms-settings:network-status` |
| Wi-Fi / Ethernet | `ms-settings:network-wifi` / `ms-settings:network-ethernet` |
| Startup apps | `ms-settings:startupapps` |
| About | `ms-settings:about` |

Availability depends on Windows version/SKU and hardware. Touchpad and Wi-Fi require their respective hardware. Windows Security here means its Settings page; do not claim it launches a particular antivirus panel. Avoid making `windowsupdate-action` or seeker routes the ordinary Updates button. On Windows 11, Microsoft says `ms-settings:display-advanced` opens Display and does not have a dedicated Advanced display URI. [Microsoft reference](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)

`ms-settings:camera` has camera-settings behavior only on Windows 11 build 22000 or later; older versions had different/deprecated behavior. For permissions use `privacy-webcam`. A device-specific route is `ms-settings:camera?cameraId=<URI-escaped symbolic link name>`; the ID is a camera device identifier, not a laptop serial. [Microsoft camera settings](https://learn.microsoft.com/en-us/windows/apps/develop/camera/launch-camera-settings)

Engineering recommendation: keep a backend allowlist of action IDs to literal destinations; never accept arbitrary executable paths or shell command strings from the frontend. Report launch failure and offer Settings root (`ms-settings:`). A successful process/API launch does not establish that a setting changed. Microsoft's [`LaunchUriAsync`](https://learn.microsoft.com/en-us/uwp/api/windows.system.launcher.launchuriasync) returns a launch-success Boolean.

## Lenovo Vantage launch, routes, support and warranty

### Installed package evidence and reliable launch

Lenovo documents PFN `E046963F.LenovoCompanion_k1h2ywk1493x8`: [HT513279](https://support.lenovo.com/us/en/solutions/ht513279). A read-only `Get-AppxPackage` plus `Get-AppxPackageManifest` on this computer found:

```text
Name: E046963F.LenovoCompanion
Version: 10.2606.12.0
PackageFamilyName: E046963F.LenovoCompanion_k1h2ywk1493x8
Application Id: App
Executable: LenovoVantage\LenovoVantage.exe
EntryPoint: Windows.FullTrustApplication
AUMID: E046963F.LenovoCompanion_k1h2ywk1493x8!App
Registered windows.protocol names:
  lenovo-vantage3
  lenovo-metro-discovery
  lenovo-metro-companion
  lenovo-companion
  lenovo-metro-settings
```

The installed package manifest was inspected, not modified. Future versions must be rediscovered. Microsoft documents [AUMID discovery](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid) and [`Get-AppxPackageManifest`](https://learn.microsoft.com/en-us/powershell/module/appx/get-appxpackagemanifest).

Recommended installed-app target: the discovered AUMID above. Use Windows app activation or Shell AppsFolder activation (`explorer.exe` with the single argument `shell:AppsFolder\E046963F.LenovoCompanion_k1h2ywk1493x8!App`), passing arguments separately. Microsoft's [AUMID documentation](https://learn.microsoft.com/en-us/windows/configuration/store/find-aumid) explains AppsFolder discovery, and [`IApplicationActivationManager::ActivateApplication`](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication) defines AUMID activation and HRESULT result semantics. This research did not launch it; verify behavior in a later user-authorized launch test. Do not hardcode the versioned executable location or assume `!App` from the PFN alone on other installations.

The manifest proves registration of schemes such as `lenovo-vantage3:`. It does **not** specify path/query semantics, homepage behavior, or supported links to battery, thermal, updates, warranty, diagnostics or support pages. No public Lenovo route contract was found for those destinations. Do not invent `lenovo-vantage://battery`, `lenovo-vantage3://...`, ImController pipe commands or private activation payloads. Label the action **Open Lenovo Vantage**, not **Open battery settings**, unless a route is independently documented and tested for that version.

Fallback Store listing: `https://apps.microsoft.com/detail/9WZDNCRFJ4MV`, or `ms-windows-store://pdp/?ProductId=9WZDNCRFJ4MV`. The [official listing](https://apps.microsoft.com/detail/9WZDNCRFJ4MV) and [Microsoft Store URI syntax](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-store-app) support this mapping; it opens the listing, not installed Vantage. The `PFN` Store parameter is deprecated. Do not silently install Vantage when launch fails.

### Serial-free destinations

Use literal generic destinations: [Warranty lookup](https://pcsupport.lenovo.com/us/en/warranty-lookup) and [PC support](https://pcsupport.lenovo.com/us/en/). Open in the default browser only after a click. Let the user enter a serial on Lenovo's page. Do not prefetch, embed a remote support page/image, auto-detect the product, call lookup APIs, or append a locally discovered serial to path/query/fragment. Generic URLs contain no serial; this is not a claim about Lenovo's cookies or behavior after navigation. Product-specific support may be offered later with the public model/type, but not by automatically injecting a serial. These are navigation actions, not a warranty-state read API.

## GameZone WMI: discovery, modes and exact arguments

Primary mappings: [`WMI.LenovoGameZoneData.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.LenovoGameZoneData.cs), [`AbstractWmiFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/AbstractWmiFeature.cs), and [`Enums.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Enums.cs).

Scope is `root\WMI`; query is `SELECT * FROM LENOVO_GAMEZONE_DATA`. These are **instance methods**, not ordinary state properties. LLT selects the first instance. Enumerate instances and method schemas before invoking explicitly allowlisted support/getter methods. Do not iterate/invoke every method during discovery: many are setters.

| Capability | Read-only support method | Getter (no input) | Setter input | Raw values |
| --- | --- | --- | --- | --- |
| Thermal/power profile | `IsSupportSmartFan` | `GetSmartFanMode` | `SetSmartFanMode(Data=<int>)` | `1` Quiet, `2` Balance, `3` Performance |
| Legacy Hybrid/MUX | `IsSupportGSync` | `GetGSyncStatus` | `SetGSyncStatus(Data=<int>)` | `0` = Hybrid on; `1` = Hybrid off / dGPU |
| GPU working mode, only if separately supported | `IsSupportIGPUMode` | `GetIGPUModeStatus` | `SetIGPUModeStatus(mode=<int>)` | `0` Default, `1` iGPU-only, `2` Auto |
| Panel overdrive | `IsSupportOD` | `GetODStatus` | `SetODStatus(Data=<int>)` | `0` Off, `1` On |

All support/getter methods above are read from output property **`Data`**, converted by LLT to Int32. LLT considers support **`Data > 0`**, catches errors as unsupported, and uses a `+1` offset only for PowerModeState. `IsSupportSmartFan` can be a version value, not just 0/1. Zero support is unsupported; negative/unknown/failed reads must not be rendered as a valid enabled state. Validate mode output against the supported set rather than copying LLT's unchecked enum cast.

### Thermal details

[`PowerModeFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/PowerModeFeature.cs) uses `GetSmartFanMode`/`SetSmartFanMode`, **not** a method named `SetThermalMode`. Its C# enum has Quiet=0, Balance=1, Performance=2, GodMode=254; wire values are therefore 1,2,3,255. Do not send the enum's zero-based thermal numbers directly.

Expose only the three standard modes initially. Custom/GodMode=255 requires additional discovery and controllers, not just SmartFan presence. [`Compatibility.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Utils/Compatibility.cs) checks advertised modes using `LENOVO_OTHER_METHOD.GetFeatureValue(IDs=0x00070000)` output `Value`, falling back to `GetSupportThermalMode()` output `mode`: bits 0/1/2/16 mean Quiet/Balance/Performance/GodMode. LLT additionally gates GodMode V1 on SmartFan versions 4/5 or LegionZone 1/2 with BIOS exclusions, and V2 on SmartFan 6/7 or LegionZone 3/4. These are LLT compatibility heuristics, not proof of a Gen6 custom-fan UI.

Performance mode needs AC per the Lenovo guide; LLT blocks it on battery by default. Its Quiet-to-Performance workaround (Balance then 500 ms) is gated to J2CN BIOS, not universally applied to all Gen6 models. Do not implement automatic profile cycling or custom fan/power-limit writes as capability tests.

Thermal events are `LENOVO_GAMEZONE_THERMAL_MODE_EVENT` and `LENOVO_GAMEZONE_SMART_FAN_MODE_EVENT` in `root\WMI`, payload `mode`. The thermal enum is **wire-oriented**: 0 Unknown, 1 Quiet, 2 Balance, 3 Performance, 255 GodMode. These should invalidate/refresh a read, not silently alter Windows plans. LLT's own listener does synchronize Windows power plans/modes; importing that listener would add writes outside a read-only dashboard. [Thermal listener](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Listeners/ThermalModeListener.cs), [thermal event](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.LenovoGameZoneThermalModeEvent.cs), [SmartFan event](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.LenovoGameZoneSmartFanModeEvent.cs).

### Hybrid and overdrive pitfalls

The name GSync is misleading: LLT uses this switch for Hybrid/MUX. This is not a generic Windows G-SYNC or Advanced Optimus toggle. In [`HybridModeFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/Hybrid/HybridModeFeature.cs), Hybrid On maps to `(GSync=0, IGPUMode=0)` and Off to `(1,0)`. iGPU-only maps to `(0,1)` and Auto to `(0,2)` only when supported. When only GSync is supported, LLT offers just On/Off. Its [README's Hybrid section](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/README.md#hybrid-mode-and-gpu-working-modes) says legacy Hybrid on/off switching needs a restart and identifies the extra working modes with Gen7/8. Do not assume four modes on 82JU or restart automatically. Show requested firmware configuration separately from active graphics topology until reboot.

LLT defaults to the GameZone iGPU interface; other capability/flags implementations require its experimental flag. It also performs dGPU notification/ejection work around newer working modes. A single raw setter is not equivalent to the complete composite transition. [IGPUModeFeature](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/Hybrid/IGPUModeFeature.cs)

Overdrive is a **panel response-time feature**, not GPU overclocking (`IsSupportGpuOC` is separate). LLT prefers capability OverDrive when advertised, falling back to GameZone OD. Support may differ with panel/firmware; never infer it from an NVIDIA GPU or refresh rate alone. [OverDrive composite](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/OverDrive/OverDriveFeature.cs)

### WMI return values: do not invent a universal success code

[`WMI.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.cs) extracts `Data` for these getters but **discards all setter output**. It wraps ManagementException and throws when no instance exists. Therefore LLT does not establish that a setter's `ReturnValue=0` (or 1) means success. Inspect actual method metadata/output; keep WMI transport/HRESULT errors separate from `Data`, `Value`, `ret` and any provider return field. None is interchangeable. A successful invocation without a verified output is not confirmed state. Later writes should reread, report mismatch and avoid unbounded retries.

## Charging and Always On USB: EnergyDrv, not GameZone methods

Sources: [`Drivers.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Drivers.cs), [`AbstractDriverFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/AbstractDriverFeature.cs), [`BatteryFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/BatteryFeature.cs), [`AlwaysOnUsbFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/AlwaysOnUsbFeature.cs).

LLT opens `\\.\EnergyDrv` with FILE_READ_DATA|FILE_WRITE_DATA, FILE_SHARE_READ|FILE_SHARE_WRITE, OPEN_EXISTING. It uses synchronous DeviceIoControl with **4-byte UInt32 input and 4-byte UInt32 output**. Device access permissions/driver availability are separate from feature support. Do not open this device or send any command merely because Vantage is installed. The designated query commands below are source-derived read operations, although the driver handle requests read/write access.

| Feature | IOCTL | Query input | Query decode |
| --- | --- | --- | --- |
| Charging mode | `0x831020F8` | `0xFF` | Byte-swap returned UInt32. If bit17=1, bit26 selects Rapid (1) vs Normal (0). Otherwise bit29=1 means Conservation. Otherwise unknown/error. |
| Always On USB | `0x831020E8` | `0x02` | Byte-swap returned UInt32. bit31=0 means Off. bit31=1 and bit23=0 means On when sleeping; both set means On always. |

Bit numbers are zero-based **after byte reversal**. Do not reverse setter inputs. LLT's [UInt32 helpers](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Extensions/UIntExtensions.cs) perform full four-byte reversal. Its charging decoder gives bit17 precedence over bit29; it is not three independent Boolean toggles or an arbitrary charging-percentage interface.

Exact setter command inputs, sent sequentially through the same feature IOCTL (documentation only; not executed):

| Desired state | Input UInt32 sequence |
| --- | --- |
| Conservation | `0x08, 0x03` if last freshly read state is Rapid; otherwise `0x03` |
| Normal | `0x05` if last state is Conservation; otherwise `0x08` |
| Rapid | `0x05, 0x07` if last state is Conservation; otherwise `0x07` |
| Always On USB Off | `0x0B, 0x12` |
| USB on when sleeping | `0x0A, 0x12` |
| USB on always | `0x0A, 0x13` |

Conservation and Rapid transitions depend on the previous state; LLT caches `LastState`. A future implementation should read immediately before writing, serialize operations and not use an uninitialized/stale cache. Multi-command sequences can partially succeed. Do not display thresholds inferred from another generation or promise a charge percentage from these mode bits.

LLT treats a successful query/decode as driver-feature support. Its base verifies writes by rereading at most ten times with 50 ms delays, but **logs mismatch rather than throwing after exhaustion**. Its low-level wrapper ignores `lpBytesReturned`; a new implementation should validate the returned byte count before decoding. [`PInvokeExtensions.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Extensions/PInvokeExtensions.cs). [Microsoft DeviceIoControl](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-deviceiocontrol) defines nonzero as API completion success; zero requires GetLastError. There is no demonstrated Lenovo status-code meaning for the output UInt32 of these setter commands.

LLT also writes `HKCU\Software\Lenovo\VantageService\AddinData\IdeaNotebookAddin\BatteryChargeMode` strings `Normal`, `Quick`, `Storage` after setting Normal, Rapid, Conservation. This is cached application preference, not an authoritative hardware getter. Do not implement the registry write as if it changes firmware; do not call LLT's `EnsureCorrectBatteryModeIsSetAsync` from a read-only poll, because it may perform writes. [BatteryFeature source](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/BatteryFeature.cs)

## Flip to Start: capability interface, then UEFI fallback

LLT's [`FlipToStartFeature`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/FlipToStart/FlipToStartFeature.cs) chooses the first supported implementation: capability, then UEFI. This is not a ThinkPad BIOS-setting name.

Capability route (only with advertised capability data): enumerate `root\WMI:LENOVO_CAPABILITY_DATA_00`, property `IDs`, and require `0x00030000` (FlipToStart). Getter is `LENOVO_OTHER_METHOD.GetFeatureValue(IDs=0x00030000)`, output `Value`: 0 Off, 1 On. Setter is `SetFeatureValue(IDs=0x00030000, value=0|1)`. The same capability protocol handles OverDrive at ID `0x001A0000`, also 0/1. Exact names/case matter when building method arguments. [`AbstractCapabilityFeature`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/AbstractCapabilityFeature.cs), [`WMI.LenovoOtherMethod`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.LenovoOtherMethod.cs), [`capability enumeration`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/System/Management/WMI.LenovoCapabilityData00.cs).

LLT falls back from capability enumeration to legacy feature flags for machine information, but `AbstractCapabilityFeature` explicitly requires **CapabilityData** source. A legacy flag or assumed FlipToStart=true in the flags compatibility record is not permission to invoke arbitrary capability methods. Capability getters reject undefined enum values; setters discard their WMI output just as noted above. Range capabilities are separately read from `LENOVO_CAPABILITY_DATA_01` (`IDs`, `DefaultValue`, `MinValue`, `MaxValue`, `Step`); their existence is not required evidence for the Boolean route. [Compatibility logic](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Utils/Compatibility.cs)

Gen6-relevant UEFI fallback from [`FlipToStartUEFIFeature.cs`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/FlipToStart/FlipToStartUEFIFeature.cs):

```text
Variable name: FBSWIF
Vendor GUID: {D743491E-F484-4952-A87D-8D5DD189B70C}
Layout: packed 4 bytes: FlipToBootEn, Reserved1, Reserved2, Reserved3
Read: GetFirmwareEnvironmentVariableEx; byte0==0 => Off, otherwise On
Write in LLT: [0|1, 0, 0, 0], attributes expression evaluates to 7
```

[`AbstractUEFIFeature`](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LenovoLegionToolkit.Lib/Features/AbstractUEFIFeature.cs) temporarily enables SeSystemEnvironmentPrivilege and considers a successful read to mean support. [Microsoft's read API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfirmwareenvironmentvariableexa) returns byte count (zero on failure, GetLastError for details), requires the privilege, and may fail with ERROR_INVALID_FUNCTION when firmware access is unsupported. Lack of privilege is not evidence that the feature is disabled. A safe implementation must require exactly the expected length, distinguish missing variable from access failure and retain unknown bytes/state. LLT accepts any nonzero length, a behavior not to copy blindly.

LLT's constants define RUNTIME_ACCESS as 7 (rather than a single bit), and the OR expression still evaluates to 7; do not copy the constant as a reusable Windows attribute definition. This research records the writer for completeness, **not approval to implement raw UEFI writes**. Keep Flip to Start unavailable or direct users to Vantage/firmware UI until this fallback has a separate review and machine validation. Never probe support by writing or deleting FBSWIF.

## Actionable implementation boundary

1. Add literal Windows routes, generic Lenovo support/warranty links and discovered-AUMID Vantage launch. Keep navigation labels honest about the page reached and handle launch failure.
2. Build a read-only capability report from local model/BIOS, WMI instance/method metadata, explicit support getters and validated state getters. Never log serials, full hardware inventory or raw package paths to a remote service. No discovery call should invoke Set*, Ensure*, Notify*, GPU eject/deactivate, firmware writes or driver write-command inputs.
3. Gate each control independently. Maintain raw values plus interpreted state, interface, last-read timestamp and error category. Show Unknown/Unavailable instead of Off for failed reads. Distinguish configured Hybrid state from active GPU routing and possible reboot requirement.
4. If writes are later authorized, use fresh reads, serialization, exact argument maps, post-write verification and bounded failure handling. Do not infer firmware success from lack of an exception or map all provider outputs to a generic zero-success convention.
5. Preserve Vantage and required services/drivers. This task establishes mappings and unresolved risks; it does not establish a tested replacement for Lenovo diagnostics, BIOS updates, custom fan curves, hardware repair tools or warranty entitlement retrieval.
