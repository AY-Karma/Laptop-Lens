@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install Desktop.ps1"
if errorlevel 1 (
  echo Desktop installation failed. Read the error above.
  pause
  exit /b 1
)
start "" "%LOCALAPPDATA%\Programs\Laptop Lens\Laptop Lens.exe"
