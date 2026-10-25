# Contributing

Use the setup and checks in [development](docs/DEVELOPMENT.md).

Keep changes focused. Explain the problem, resulting behavior, and checks in each pull request. For UI changes, include a screenshot with personal information removed.

Hardware support needs evidence: model family, Windows version, provider availability, and valid readback. Do not bypass the model guard to test firmware writes on an unverified device. Missing readings must stay unavailable rather than become zero or Off.

Never commit telemetry exports, serial numbers, device IDs, credentials, generated builds, or local logs. See [SECURITY.md](SECURITY.md) for vulnerability reports.

Contributions are provided under the [MIT License](LICENSE). Preserve third-party license notices.
