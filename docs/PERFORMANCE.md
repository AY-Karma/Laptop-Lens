# Performance

Collection and frontend polling stop while the native window is minimized. Overview samples processes every 5 seconds; the Processes view uses its selected 1/2/5-second cadence. Incremental responses omit unchanged process rows and older history.

## Development spot checks

| Measurement | Before optimization | After optimization |
| --- | ---: | ---: |
| Active process-tree CPU, total system share | 0.23% mean over 34.6 s | 0.136% mean over 20.1 s, process polling disabled |
| Ordinary snapshot payload | 202,495 bytes | 8,061 bytes |
| Snapshot request time | 329 ms mean, 5 requests | 27 ms incremental request |
| Collector time with process list | 125 ms | 109 ms |

In one 16.1-second minimized run, Windows process accounting recorded no CPU-time increase across the seven-process tree. No telemetry samples were produced. Private memory was 228.2 MiB, including WebView2.

These are short measurements on one development machine, not a controlled comparison with Vantage or a performance guarantee. WebView2 retains a baseline memory footprint. Results vary with workload, refresh speed, and provider availability.
