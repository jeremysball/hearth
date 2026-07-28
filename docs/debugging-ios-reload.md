# Investigating the iOS "full refresh" reports

A runbook for the ongoing bug report: the app does a full refresh on iOS every
few minutes, worst on one caregiver's phone, occasionally on the other's.

## What's been ruled out

- **Not the deploy pipeline, currently.** Watchtower is broken right now and
  isn't restarting the `app` container, so `sw.js` bytes on the phone can't
  have changed. The `controllerchange` → `window.location.reload()` path in
  `js/app.js` (~840-849) is real and worth fixing eventually, but it can only
  fire after a genuine deploy, and no deploys are reaching production at the
  moment.
- **Not "every commit is a deploy."** `main` only advances on a merge; a
  multi-commit worktree branch (e.g. six commits on a feature branch) lands
  as one merge commit and triggers one deploy at most, not one per commit.
- **Not our own JS while a bottom sheet is open.** `ui.js`'s `sheet.open()`
  adds a `show` class to `#scrim`; `editingInProgress()` in `app.js` checks
  exactly that before ever calling `reloadNow()`. A reload triggered by our
  own code is gated shut for the entire time a log-entry sheet is open. If a
  refresh happens *while* someone is sitting in an open sheet, it did not
  come from this code path.

## Leading hypothesis

iOS/WebKit terminating the backgrounded standalone PWA to reclaim memory,
then cold-relaunching it (full white-flash restart, not a quiet in-page
reset) the next time it's foregrounded. Not a code bug — a platform behavior
for home-screen web apps with no app-side opt-out. Consistent with the
"sitting in a sheet for a while" pattern: stepping away to check something
else mid-entry is exactly when Hearth gets backgrounded long enough to be
evicted. Two pieces of prior evidence in this repo that this exact class of
event has happened before:

- `js/changelog.js:67` (2026-07-08 fix) — "unsaved changes to an existing
  entry sometimes vanishing if the app got reloaded mid-edit (e.g. the phone
  reclaiming memory in the background)."
- Commit `28c1078`'s message names the same mechanism directly.

## Setting up Safari remote debugging

Any Mac works — no minimum macOS/Xcode version needed for this, unlike a
Capacitor build.

1. On the iPhone: **Settings → Safari → Advanced → Web Inspector** (toggle on).
2. On the Mac: **Safari → Settings → Advanced → Show Develop menu in menu bar**
   (older Safari: Preferences instead of Settings).
3. Connect the iPhone to that Mac via USB (or same Wi-Fi network on iOS
   17+ with wireless debugging already paired once over USB). Tap "Trust
   This Computer" on the phone if prompted.
4. On the Mac: Safari's **Develop** menu → the device name → the open Hearth
   tab. This attaches a live Web Inspector (Console, Network, Timelines,
   Memory) to the page actually running on the phone.

## What to look for when a refresh happens

- **Inspector session just disconnects, no console output first** →
  WebKit's content process was killed by the OS. Confirms the eviction
  hypothesis. Cross-check with **Console.app** on the Mac around the same
  timestamp — search for `WebContent` or `jetsam`; a memory-pressure kill
  shows up there even if the Inspector session itself gives no detail.
- **A console error or an explicit reload call is logged right before the
  disconnect** → this is not OS eviction, and reopens the code-side
  investigation (check for anything besides `js/app.js:833`'s
  `window.location.reload()` — `rg` currently finds no other call site, but
  re-check if this line of reasoning is ever revisited).
- **Memory graph (Timelines → Memory) climbing steadily before the event,
  even while foregrounded and not backgrounded** → would point at something
  in-app (a leak, an unbounded array, a growing canvas/context count) rather
  than pure OS backgrounding behavior, and would need its own investigation
  into `js/sky.js`'s particle/rAF lifecycle and `store.js`'s in-memory
  `_state.log` size over a long logging history.
- **Correlate with what she was doing right before it happened** — did she
  switch apps (camera, texts, calls) mid-entry, or was the phone continuously
  in the foreground the whole time? The former supports eviction; the latter
  would be surprising and worth flagging immediately, since foreground apps
  are rarely killed by iOS outside genuine system-wide memory pressure.

## First real capture: 2026-07-28, `hearth.bass-procyon.ts.net-recording.json`

A 42s Safari Timelines recording (`~/.moshi/uploads/hearth.bass-procyon.ts.net-recording.json`),
taken on a Mac too underpowered to sustain a live Web Inspector session for
longer — the recording itself is still good evidence even though the session
had to be cut short.

- **`memoryPressureEvents` (a dedicated field in the export, not something
  cross-checked via Console.app) shows a real critical event**: six
  `non-critical` notices clustered at the 15.2-16.3s mark, then one
  `critical` at 27.56s.
- **The CPU instrument shows a sharp spike right at the critical event**:
  usage climbs from a steady ~26-28% baseline to 79.2% (26.89s) then 95.5%
  (27.39s) — bracketing the 27.56s critical mark exactly — before decaying
  back to baseline by 29.9s.
- **Correction, retracted:** an earlier pass of this doc claimed the spike
  "predates all captured network activity," derived by mapping
  `timeline-record-type-network`'s wall-clock `startedDateTime` +
  `archiveStartTime` onto the recording's internal clock. That mapping is
  **not trustworthy** — applied consistently, it places several network
  entries *after* the recording's own `endTime` (57.15s), which is
  impossible, so the anchor assumption (that `archiveStartTime` lines up with
  `recording.startTime` on the same clock) is wrong. Do not rely on that
  correlation without a verified anchor between the two clocks; right now
  there isn't one in this export.
- **What the internal clock does show reliably (script/CPU/memory all share
  it): a real touch gesture lands exactly in the spike window.**
  `event-dispatched` records show `pointerdown` at t=26.496s (×4, matching
  the 4 legitimate document-level `pointerdown` listeners in `js/app.js`
  lines 377/406/432/550 — not a duplicate-registration bug, just normal
  delegation), then `pointermove`/`touchmove` at t≈27.576-27.59s, `pointerup`
  ×4 at t=27.59s, then another `pointerdown` ×4 at t=28.493s. This is a real
  drag-style interaction (press, move, release, press again) landing right on
  top of the 79.2%→95.5% CPU climb and the 27.56s critical memory-pressure
  mark — not an idle-background event. 68 `animation-frame-fired` events in
  the same 2.5s window are consistent with a pointermove-driven rAF loop
  (candidates: `js/sheets.js`'s bottom-sheet drag-follow render loop, or
  `js/app.js`'s stepper drag `ptrUpdate`) running alongside whatever the
  touch triggered, not with an idle ambient system like `js/sky.js`'s
  particle loop (which should be near-silent without a live spawn event).
  **This shifts the leading hypothesis from an autonomous background
  leak/animation toward interaction-triggered work** — a drag gesture (sheet
  open/close, or a stepper) landing during, or triggering, real CPU/memory
  pressure. Not yet confirmed which specific handler; worth instrumenting
  `js/sheets.js`'s drag-follow loop and `js/app.js`'s `ptrUpdate` next.
- **No discontinuity or page-load network entry appears in this recording** —
  it ends at 57.15s without ever showing the actual reload, so this capture
  confirms a real critical memory-pressure event with a plausible in-app
  trigger, but not yet the eviction/reload itself. A longer, uninterrupted
  recording (ideally not on a resource-constrained Mac) is still needed to
  close the loop from "critical pressure event" to "content process killed."
- Separately (likely unrelated to the spike, just observed in the same
  capture): after the spike, `/api/sync` fires far more often than the
  15s `setInterval(syncOnce, 15000)` in `js/app.js` would predict on its own
  — consistent with `connectEvents()`'s `eventSource.onmessage` triggering
  its own `syncOnce()` per SSE push, which tracks with the PUT/DELETE to
  `/api/entries/...` also visible in this window (the device's own edit/undo,
  each likely echoed back over SSE). Not flagged as a problem — just noted so
  a future read of this capture isn't surprised by the call volume.

## Leading hypothesis, updated: unguarded `AudioContext.resume()` in `js/fx.js`

New evidence (2026-07-28, reported directly from the affected phone's own
console): **`Unhandled Promise Rejection: InvalidStateError: Failed to start
the audio device.`** This is WebKit's exact, specific wording for a failed
`AudioContext.resume()` call — not a generic script error — and there is
exactly one `.resume()` call site in the whole codebase:

```js
// js/fx.js:6-12
function getCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
```

`resume()` is called with no `.catch()`, no error handling, and — critically
— **no backoff or failure tracking**. If the underlying audio hardware ever
gets into a state where `resume()` rejects, `audioCtx.state` stays
`'suspended'` (a rejected resume doesn't transition it to `'running'`), so
every subsequent call to `getCtx()` retries the exact same failing
`resume()` again, unconditionally, forever.

This matters because of how often `getCtx()` gets called on iOS specifically:
**`navigator.vibrate` does not exist on iOS Safari at all**, so `buzz()`
(`js/fx.js:101-107`) always falls through to `hapticAudio()` → `getCtx()` on
iPhone — there's no vibration fallback taking the load off audio there.
Call-site frequency once the context is wedged:

- `js/sheets.js:174`'s `maybeBuzz()` throttles to once per **40ms** during a
  spinner drag — a ~1s drag (the same drag/pointermove shape captured in the
  Timeline recording above) alone fires ~25 unguarded, doomed `resume()`
  attempts.
- `js/app.js`'s stepper long-press repeats every 75ms (`_stepperTimer`,
  line 389-390) — same story, same doomed retry every tick.
- `js/app.js:497`'s pull-to-refresh armed threshold and `js/sheets.js`'s
  entry-save chimes (lines 711/737/764) all route through the same
  unguarded call.

This directly explains the "worst on one caregiver's phone" pattern the
original report already named: it only needs *that* phone's audio session to
get stuck once (a Bluetooth device switch, a Siri/Phone/Camera audio
interruption, the ringer/silent switch racing `AVAudioSession` activation —
any of the usual iOS audio-session-conflict triggers), and from that point on
every drag, long-press, or save on that phone hammers a doomed `resume()` at
whatever cadence the user is interacting, each one an unhandled rejection.
It's also consistent with the Timeline capture: the CPU/memory spike landed
exactly on a drag gesture, which is exactly the shape of interaction that
would retry `resume()` most aggressively (spinner drag, 40ms throttle).

**Not yet proven**, to be precise about confidence: this recording's
`event-dispatched` records don't carry console-error entries, so this
specific capture doesn't show the "Failed to start the audio device" message
landing inside the same 26-28.5s window — that correlation is inferred from
the drag/timing match and the call-site frequency, not read directly off this
recording. The console-error report and the Timeline capture are two
separate pieces of evidence pointing the same direction, not one trace
showing both. Confirming it fully would mean either reproducing with
DevTools console open during a drag on the affected phone, or getting a
recording where `console.error`/unhandled-rejection entries are visible
alongside the CPU/memory instruments.

This is a genuine, fixable code bug regardless of whether it's the exact
mechanism behind the OS-eviction reloads — an unguarded, unbounded-retry
promise rejection firing on every drag frame is worth fixing on its own
merits (uncaught rejections are not free; WebKit logs them, and depending on
iOS version repeated audio-session activation attempts can carry real
per-call system cost). Whether fixing it also resolves the reload reports is
a separate question this doc can't answer yet without a fix landing and time
passing to see if reports stop.

## If this confirms OS eviction

There's no full in-app fix — iOS gives standalone home-screen web apps no
guaranteed background execution. The two mitigations available from within
the current architecture: reduce Hearth's own memory footprint (lowers the
odds of being picked for eviction under pressure) and make a cold restart
less disruptive (faster boot, restore the exact view/scroll/sheet state from
`localStorage` instead of just returning to the home view). The only way to
eliminate OS-triggered kills entirely is wrapping the app in a native shell
(e.g. Capacitor) for real background execution guarantees — a much bigger
architectural step than this bug alone justifies, evaluated separately.
