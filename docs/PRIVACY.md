# Privacy

Laptop Lens collects telemetry locally. It has no account, analytics service, or automatic telemetry upload.

- Live history stays in memory for up to one hour and clears on exit.
- The WebView2 profile and error log are stored in `%LOCALAPPDATA%/Laptop Lens`.
- Regular exports omit device-details serial numbers, device IDs, and Windows product IDs. Reports can still contain process names, IP/MAC addresses, and startup locations.
- Device identifiers stay hidden in the UI until revealed. Copy actions are explicit.
- Lenovo support links and Windows destinations open only after a click. External pages have their own privacy policies.

The collector binds to loopback on a random port. Host/Origin checks reject unexpected browser requests, but other local programs running as your user can read loopback telemetry.

The app starts without administrator access. Enabling Lenovo controls explicitly requests Windows consent; opening the app does not change firmware settings. Closing the window stops its collector and helper processes.
