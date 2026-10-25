# Development

## Requirements

- Windows 11 x64, Python 3.12 x64, Node.js 22, and npm.
- Microsoft Edge WebView2 and .NET Framework 4.8 for the native shell.

## Setup and run

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-build.txt
npm ci
npm run build
.venv\Scripts\python desktop.py
```

For frontend development, run `.venv\Scripts\python app.py` and `npm run dev` in separate terminals. Browser mode does not expose native device or process actions.

## Check

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
npm run build
```

Tests mock firmware writes. Check provider availability and readback before expanding device support.

## Package

`Build Desktop.cmd` creates `release/Laptop Lens/Laptop Lens.exe`. Keep `_internal` alongside it. The build includes the project license and third-party license texts.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\package_release.ps1
```

Packaging creates a standalone EXE, a portable ZIP, and SHA-256 checksums in `release/`. Binaries belong in GitHub Releases, not source commits. The standalone EXE extracts its runtime on each launch; the ZIP bundle avoids that step. `Install Desktop.cmd` optionally copies the bundle to your user profile and creates shortcuts. It adds no service or startup task.

## Source map

- `desktop.py`: native window, consent, and bounded actions.
- `telemetry.py`, `windows_*.py`: collection and Windows performance data.
- `legion_controls.py`: model-guarded firmware controls.
- `system_actions.py`, `process_actions.py`: settings and process actions.
- `src/`: React interface and charts.
- `tests/`: collector, control, and native-contract tests.

Research: [Vantage](RESEARCH.md), [control protocols](CONTROLS-RESEARCH.md), [performance APIs](TASK-MANAGER-RESEARCH.md).
