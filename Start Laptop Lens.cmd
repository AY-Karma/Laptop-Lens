@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\Laptop Lens\Laptop Lens.exe" (
  start "" "%LOCALAPPDATA%\Programs\Laptop Lens\Laptop Lens.exe"
  exit /b
)
if exist "release\Laptop Lens\Laptop Lens.exe" (
  start "" "%~dp0release\Laptop Lens\Laptop Lens.exe"
  exit /b
)
if exist ".venv\Scripts\pythonw.exe" (
  start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0desktop.py"
  exit /b
)
echo Run Build Desktop.cmd and then Install Desktop.cmd first.
pause
