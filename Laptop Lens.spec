# Reproducible Windows onedir bundle. Keeps Vite's dist separate from EXE output.
from PyInstaller.utils.hooks import collect_data_files
from pathlib import Path
import sys
import os
import json

sys.path.insert(0, str(Path(SPECPATH) / 'tools'))
from collect_licenses import collect

if sys.maxsize <= 2**32:
    raise RuntimeError('Build the Windows x64 release with 64-bit Python.')
licenses = collect(Path(SPECPATH) / 'build-desktop' / 'licenses')

a = Analysis(
    ['desktop.py'], pathex=[], binaries=[],
    datas=[('dist', 'dist'), ('assets', 'assets'), (str(licenses), 'licenses')] + collect_data_files('webview'),
    hiddenimports=['webview.platforms.edgechromium', 'webview.platforms.winforms', 'desktop_smoke'],
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'tkinter', 'gi'],
    noarchive=False,
)
pyz = PYZ(a.pure)
options = dict(debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
               console=False, icon='assets/laptop-lens.ico', version='desktop-version.txt')
if os.environ.get('LAPTOP_LENS_ONEFILE') == '1':
    version = json.loads((Path(SPECPATH) / 'package.json').read_text())['version']
    exe = EXE(pyz, a.scripts, a.binaries, a.datas, [],
              name=f'Laptop-Lens-{version}-Windows-x64', **options)
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Laptop Lens', **options)
    coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='Laptop Lens')
