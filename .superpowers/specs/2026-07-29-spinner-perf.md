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

Baseline lag was already established before this log existed, so it was not
re-captured here. The standing evidence is `spinner-logs.json` and the
avatar-fire verification spec: paint rises from roughly 160-180 records/sec
idle to roughly 1,000-1,250 records/sec during the picker window, with
MutationObserver and script-evaluated records spiking to roughly 171/sec in
the same window. The picker window is the dominant frame-budget consumer.

## Experiment A: pause ambient fire while the picker is open

Change: `setAmbientPaused(true)` on `openSpinner`, `setAmbientPaused(false)`
on close (`js/app.js`, `js/sheets.js`), plus a `body[data-no-fire]` rule that
stops the fire-a/b/c animations on `body`, `.tok`, `.card`, `.info-card`, and
`.tabbar` (`styles.css`).

Result: on-device verification on the iPhone 15 in iOS Safari (user-captured,
same workflow as the baseline) showed the picker scrolling at a sustained
60fps. The user reported the lag fully resolved. Formal harness median/p95
values were not transcribed into this log; the on-device result is the
acceptance evidence for shipping this variant.

## Decision

Ship Experiment A. It is the smallest variant that passes the gate: a CSS
animation pause scoped to the picker's lifetime, no renderer change, cylinder
geometry untouched, all 22 `tests/spinner.test.js` checks and 106 unit tests
green. Experiments B-F (no-fades, diff DOM writes, will-change variants,
stable text child, canvas renderer) are not needed and were not run.
