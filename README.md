<div align="center">
  <img src="assets/laptop-lens.svg" alt="Laptop Lens" width="64" height="64" />
  <h1>Laptop Lens</h1>
  <p><strong>Understand what your laptop is doing.</strong></p>
  <p>A Windows desktop monitor for Lenovo laptop owners who want clear performance data and quick access to device controls.</p>
</div>

## Why use it

- **Find the workload.** Track CPU, memory, disks, network, and supported NVIDIA GPUs with live graphs and process icons.
- **Understand your battery.** See charge, AC state, and capacity readings where the hardware exposes them.
- **Reach device controls.** Adjust supported Legion settings or open the relevant Windows and Lenovo tools.
- **Keep it local.** No account or cloud telemetry. Export JSON reports and CSV history when needed.
- **Reduce background work.** Collection stops while minimized. Process sampling runs only where needed.

## Compatibility

Built for **Windows 11 x64** with [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/). Standard monitoring uses Windows APIs; available readings depend on the device and drivers.

Direct Lenovo controls are currently limited to **Legion 5 15ACH6H (82JU)** with compatible Lenovo drivers. Other models retain monitoring and settings shortcuts. Support for every Lenovo model has not been verified. [Compatibility details](docs/COMPATIBILITY.md).

## Your data

History stays in memory for up to one hour and clears when the app closes. Settings and logs stay on your PC. Exports can contain process names, network addresses, and startup locations; review them before sharing. [Privacy details](docs/PRIVACY.md).

## Build and contribute

Use Windows, Python 3.12 x64, and Node.js 22. Run `Build Desktop.cmd` to build the desktop bundle. See [development](docs/DEVELOPMENT.md), [contributing](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md).

## Download

**[Download Laptop Lens 0.1.0 ? Windows portable (.exe)](https://github.com/AY-Karma/Laptop-Lens/releases/download/v0.1.0/Laptop-Lens-0.1.0-Windows-x64.exe)**

[Portable ZIP](https://github.com/AY-Karma/Laptop-Lens/releases/download/v0.1.0/Laptop-Lens-0.1.0-Windows-x64.zip) ? [All releases](https://github.com/AY-Karma/Laptop-Lens/releases)

Run the standalone EXE directly. For quicker launches, extract the ZIP and keep `_internal` beside `Laptop Lens.exe`. The standalone EXE extracts its runtime to a temporary folder on launch. Builds are unsigned. Laptop Lens is an independent project and is not affiliated with Lenovo.

Copyright ? 2026 AY-KARMA. [MIT License](LICENSE).
