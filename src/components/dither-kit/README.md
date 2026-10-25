# Dither Kit sources

Modified shared painting and donut sources from [Dither Kit](https://github.com/Boring-Software-Inc/dither-kit), originally imported through the [Tripwire registries](https://www.tripwire.sh/r/) on 2026-10-17.

Upstream declares MIT in package metadata. See [third-party notices](../../../THIRD_PARTY_NOTICES.md) and the preserved declaration in `licenses/dither-kit-package.json`.

Local changes use `dk-*` classes, remove unused chart dependencies, expose hover state, and cache canvas paints to avoid unchanged redraws. Laptop Lens uses these primitives for memory composition and live telemetry charts.
