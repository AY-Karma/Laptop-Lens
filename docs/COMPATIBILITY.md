# Compatibility

Laptop Lens 0.1.0 targets **Windows 11 x64**, Microsoft Edge WebView2, and .NET Framework 4.8. Linux, macOS, ARM64, and 32-bit Windows are not supported release targets. Python and the app dependencies are bundled; WebView2 is a separate [runtime requirement](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).

## Monitoring

Standard monitoring uses Windows APIs and can run on Lenovo models beyond Legion 82JU. Other brands may also work. Only one laptop configuration has been used for local hardware validation; this is not universal Lenovo certification.

| Area | Availability |
| --- | --- |
| CPU, RAM, volumes, disk/network rates | Windows/psutil readings; counters can be unavailable or restricted. |
| Battery capacity and cycles | Depends on battery firmware and WMI providers. |
| Disk activity and response time | Depends on available Windows performance counters. |
| GPU | First NVIDIA GPU exposed by `nvidia-smi`; Intel/AMD and multi-GPU telemetry are not implemented. |
| Processes | Inaccessible or exited processes are skipped. CPU needs two samples. |
| Temperatures and fan speed | Lenovo provider or supported NVIDIA readings; no generic CPU sensor driver. |

Unsupported readings remain unavailable. CPU utilization, shared working sets, cache categories, and process I/O may differ from Task Manager accounting. NVIDIA polling can wake a sleeping GPU and can be disabled.

## Lenovo controls

Direct controls require manufacturer `LENOVO` and model **82JU**, identified by Lenovo as [Legion 5 15ACH6H](https://download.lenovo.com/pccbbs/pubs/legion_5_15_17_6/html_en/EN/ug_notice.html). The guard in [legion_controls.py](../legion_controls.py) also requires valid provider readings. It does not establish compatibility with every BIOS or panel configuration.

- Charging modes and Always On USB require the installed Lenovo Energy Management driver.
- Thermal mode, Hybrid, overdrive, and touchpad lock require the GameZone provider and administrator access.
- Writes use fresh reads and confirmation. Multi-command changes can partially apply if confirmation fails.
- Performance mode requires AC. Hybrid changes apply after a user-initiated Windows restart.

The app installs no Lenovo driver. Other ThinkPad, Yoga, IdeaPad, LOQ, and Legion models use monitoring and Windows/Lenovo shortcuts; they do not receive direct controls. Vantage opens to its general UI because internal feature routes are not verified. Settings routes depend on [Windows version and hardware](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings).

Custom fan curves, BIOS flashing, raw UEFI/EC writes, full SMART diagnostics, and warranty entitlement checks are not implemented. See [control research](CONTROLS-RESEARCH.md) and [performance API research](TASK-MANAGER-RESEARCH.md).
