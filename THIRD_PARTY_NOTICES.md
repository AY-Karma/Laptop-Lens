# Third-party notices

Laptop Lens's original source and artwork are MIT-licensed, copyright ? 2026 AY-KARMA. Third-party components retain their own terms.

| Component | License / use |
| --- | --- |
| React and React DOM | MIT; bundled frontend runtime. |
| Dither Kit | MIT declared in upstream package metadata; modified chart sources. |
| psutil | BSD-3-Clause; Windows telemetry. |
| pywebview | BSD-3-Clause; native desktop shell. |
| pythonnet / clr-loader | MIT; .NET interop. |
| proxy_tools | BSD notice in upstream LICENSE.txt; package metadata separately declares MIT. |
| WebView2 SDK assemblies and loader | Microsoft license and bundled third-party notices, preserved in `licenses/`. |
| Python | Python Software Foundation license and included notices. |
| PyInstaller | GPL with its bootloader distribution exception. |

The packaged app includes dependency license texts under `_internal/licenses/`. This includes applicable transitive-dependency notices. Development dependencies retain the terms distributed with their packages. WebView2 and Lenovo/NVIDIA drivers are separately installed system components, not relicensed or bundled by this project.

## Chart sources

Modified Dither Kit sources live in `src/components/dither-kit/`. Upstream: [Boring-Software-Inc/dither-kit](https://github.com/Boring-Software-Inc/dither-kit), with MIT declared in [package.json at 1e7faee](https://github.com/Boring-Software-Inc/dither-kit/blob/1e7faee9aa252e499651e6736ed65f7a07d9a6bd/package.json). The upstream revision provides no separate copyright notice or LICENSE file. The available license declaration is preserved in `licenses/dither-kit-package.json`; standard MIT terms and this provenance accompany it. No upstream copyright holder or year has been invented.

Charts were adapted from the author's Finverse project and retain their upstream provenance. App icons are original vector artwork; executable icons shown in process lists come from locally installed applications and are not redistributed as app assets.

## Lenovo protocol research

[LenovoLegionToolkit](https://github.com/BartoszCichecki/LenovoLegionToolkit/tree/63c173024495bae37283e247f11953a09f79ba11) is a GPLv3 project consulted for protocol facts: method names, wire values, bit positions, and command sequences. Laptop Lens implements its own Python control layer from the research tables; it does not bundle or link LLT code or binaries. LLT's implementation remains under its [GPLv3 license](https://github.com/BartoszCichecki/LenovoLegionToolkit/blob/63c173024495bae37283e247f11953a09f79ba11/LICENSE), and is not covered by Laptop Lens's MIT grant. Retain this distinction when contributing.
