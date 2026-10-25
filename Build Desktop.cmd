@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto fail
".venv\Scripts\python.exe" -m pip install -r requirements-build.txt
if errorlevel 1 goto fail
call npm ci
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --distpath release --workpath build-desktop "Laptop Lens.spec"
if errorlevel 1 goto fail
echo Built release\Laptop Lens\Laptop Lens.exe
exit /b
:fail
echo Desktop build failed. Read the error above.
pause
