# Spinner 60fps investigation log

This file records what each experiment captured, what the harness measured,
and what the interpretation is. It is a lab notebook, not a user-facing spec.

## Baseline (Task 2)

Capture paths: `/tmp/spinner-baseline-N.json` for N = 1..3

Conditions: stock `fix/ios-fire-memory-leak` HEAD. Open the picker on the
bottle amount field with no prior in-flight work. Drag 220px up over 1s.
Idle 1s. Close.

Same device, OS, and Safari build for every capture.

### Frame timing summary (median of three runs)

| Metric        | Run 1 | Run 2 | Run 3 | Median |
|---------------|-------|-------|-------|--------|
| median (ms)   |       |       |       |        |
| p95 (ms)      |       |       |       |        |
| p99 (ms)      |       |       |       |        |
| max (ms)      |       |       |       |        |
| frames >16.67 |       |       |       |        |
| frames >33.3  |       |       |       |        |
| gate          |       |       |       |        |

### Safari trace counts (per picker window)

- paint records/sec
- layout records/sec
- MutationObserver callbacks/sec
- rAF callbacks/sec

### Interpretation

[5-10 sentences]
