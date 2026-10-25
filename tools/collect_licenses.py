"""Collect installed dependency notices for the Windows bundle."""
from importlib import metadata
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def collect(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    inventory = []
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
        name = dist.metadata['Name']
        target = destination / 'python-packages' / name
        notices = [f for f in dist.files or []
                   if Path(str(f)).name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE'))
                   and Path(str(f)).suffix.lower() not in ('.py', '.pyc')]
        for i, file in enumerate(notices):
            source = Path(dist.locate_file(file))
            if source.is_file():
                target.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target / f'{i:02d}-{source.name}')
        inventory.append({'name': name, 'version': dist.version,
                          'license': dist.metadata.get('License-Expression') or dist.metadata.get('License', '')})
    packages = list((ROOT / 'node_modules').glob('*'))
    packages += [p for scope in (ROOT / 'node_modules').glob('@*') for p in scope.iterdir()]
    found = set()
    for package in packages:
        manifest = package / 'package.json'
        if not manifest.is_file():
            continue
        data = json.loads(manifest.read_text(encoding='utf-8'))
        name = data['name']
        notices = [p for p in package.iterdir() if p.is_file()
                   and p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE'))]
        for source in notices:
            target = destination / 'javascript-packages' / name.replace('/', '--')
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target / source.name)
            found.add(name)
        inventory.append({'name': name, 'version': data.get('version'), 'license': data.get('license')})
    missing = {'react', 'react-dom', 'scheduler', 'vite'} - found
    if missing:
        raise RuntimeError(f'Missing JavaScript license texts: {sorted(missing)}. Run npm ci.')
    python_license = Path(sys.base_prefix) / 'LICENSE.txt'
    if not python_license.is_file():
        raise RuntimeError('The Python distribution must include LICENSE.txt.')
    shutil.copyfile(python_license, destination / 'Python-LICENSE.txt')
    shutil.copytree(ROOT / 'licenses', destination / 'vendored', dirs_exist_ok=True)
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md'):
        shutil.copyfile(ROOT / name, destination / name)
    (destination / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    return destination


if __name__ == '__main__':
    collect(ROOT / 'build-desktop' / 'licenses')
