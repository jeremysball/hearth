# Away time block (#149) — design

## Problem

There's currently no way to mark a stretch of time as "baby was with a
babysitter/other parent, nothing was logged, and that's expected" — a gap
in the log reads identically to a gap that should be there (an actual
missed nap or feed). This corrupts wake-window and overtired-lag insights,
which infer real awake duration from the gap between consecutive logged
sleep entries.

Supersedes #143 (which described this as a plain point-in-time activity
type); this issue refines it into a start/end block.

## Data model & entry UI

New log entry `type: 'away'`, shape `{ type: 'away', start, end?, note? }` —
identical pattern to `sleep`: blank `end` means the block is still ongoing
(live), a filled `end` means it was logged after the fact. No new sync/CRUD
work needed since the server already stores every entry type generically
(`log_entries.payload_json`, only `start` is a first-class column).

- `js/sheets.js`: add `'away'` to the type-picker list, `FORMS.away`
  (reuses the same `dtPair` start/end fields sleep uses, plus the optional
  note field), `gather()`, and the edit-prefill branch.
- Icon: Lucide `door-open`, vendored as a new `<symbol>` in `index.html`'s
  sprite (not currently present).
- `js/ui.js` `TYPES.away`: label `'Away'`, icon `door-open`, tone
  `'note'` (reuses the existing neutral gray tone rather than adding a new
  color token).
- `js/home.js` `summary()`: case for `'away'` mirroring `'sleep'` — label
  `'Away'` (ongoing) / `'Was away'` (completed), detail `since HH:MM` or
  `HH:MM – HH:MM`, meta `'now'` or duration.
- `js/timeline.js`: add `'away'` to `OPTIONAL_FILTERS`.

## Home hero display

An ongoing away block means the app genuinely doesn't know whether baby is
asleep or awake, so it overrides both:

- `js/store.js` `derive.status()`: check for an ongoing away entry
  (`type==='away'`, no `end`, `start <= now`) *before* the existing sleep
  check. If found, return `{ state: 'away', since: entry.start }` instead
  of computing asleep/awake.
- `js/store.js` `derive.sweetSpot()`: add an early `away` gate, same shape
  as the existing `night`/`newborn` gates: `{ away: true, napping: false,
  from: null, to: null, prediction: null }`. Suppresses the wake-window
  rail, since there's nothing meaningful to predict.
- `js/store.js` `derive.sweetSpotSchedule()`: same `away` gate at the top
  (return `[]` while an away block is ongoing) — this function independently
  reads `derive.status()` and projects a list of upcoming nap windows for
  the Sleep view, so without this it would keep projecting nap windows
  anchored to the away block's start.
- `js/home.js` `heroCard()`: new branch for `sp.away`, styled like the
  existing `night` branch — "Away since HH:MM," a plain timer, no
  sweetspot rail, no ember glow. The ambient sky background (`heroSky`)
  keeps rendering unchanged; it's driven by time-of-day and the `asleep`
  boolean only, which stays `false` during away.

## Trends/insights exclusion

Two `store.js` functions compute a wake-gap duration directly from
timestamps between consecutive logged sleeps, and both are corrupted if an
away block overlaps that gap (a real nap may have happened at the
sitter's and gone unlogged):

- `personalWakeWindow()` — feeds the wake-window prediction shown as the
  sweetspot rail.
- `insightOvertiredLag()` — the overtired-lag insight card.

Both get a shared helper, `overlapsAway(startMs, endMs)`, checking against
a new `aways()` accessor (mirrors the existing `sleeps()` accessor). Any
wake-gap interval that overlaps an away block is **dropped from the
sample entirely** — not adjusted by subtracting overlap minutes, since a
contaminated gap isn't a clean "how long can baby stay awake" observation
regardless of how much of it overlaps.

`insightDurationTrend()` and `insightMethodQuality()` need no change —
both only look at logged sleep entries' own duration/quality, never at
gaps between entries.

## Reminders pause

Server-side, `server/push.go`'s `familyReminders()` gets one query at the
top: look up whether the family has any ongoing `type='away'` entry
(`end IS NULL AND start <= now`). If so, return no reminders at all for
that family — a babysitter isn't going to log a bottle. Reminders resume
automatically once the away entry gets an `end`, on the next `ScheduleAll`
tick or entry-triggered reschedule (both already exist, no new plumbing
needed). Checking for *any* ongoing away rather than just the most recent
one matches the semantics `derive.status()` already uses client-side, and
is more correct if an older away block was ever left unclosed.

**Client-side reminders are being removed, not just away-gated.**
`js/reminders.js`'s `scheduleReminders()` independently re-schedules
bottle/meds/hygiene notifications via `setTimeout`, duplicating a channel
that already works: `server/push.go`'s scheduler already delivers those
same three reminder types via real Web Push, which `sw.js`'s `push` event
handler shows even when the app is closed or backgrounded — exactly the
condition under which a `setTimeout`-based timer gets throttled or killed
by the browser. The client-side path was the source of "sometimes no
notification arrives," and it's also what made the away-block gap in
finding #2 possible (the design's reminders-pause only covered server
push). Delete the bottle/meds/hygiene branches from
`derive.reminders()`/`scheduleReminders()` entirely; they no longer need
an away gate because they no longer exist. The nap reminder branch stays
client-side (there is no server-side equivalent of the SweetSpot
age/wake-window prediction algorithm to move it to) and keeps relying on
the `sweetSpot()`/`sweetSpotSchedule()` away gates above.

**Lead time moves server-side too, to avoid a silent feature regression.**
Profile settings expose "Remind me before" (`settings.reminders.lead`,
0/10/20/30 min) — client-only today, with no server equivalent. Deleting
the client bottle/meds/hygiene branches without porting this would silently
turn that setting into a no-op for 3 of its 4 reminder types. `push.go`
already has the exact mechanism this needs: `pushReminder.DueAt` (the true
due moment, used as the backoff dedupe key) versus `pushReminder.At` (the
actual fire time, which backoff can already push later). Lead is the same
idea in the other direction — pushing `At` earlier than `DueAt` — so it
reuses the same fields:

- `reminderSettings` gains `Lead float64` (minutes, `json:"lead"`,
  zero-value default matches the client's `lead: 0` default — no migration
  needed).
- `familyReminders()` additionally sets `LeadTitle`/`LeadBody` (new
  `pushReminder` fields) on the bottle/meds/hygiene reminders it builds,
  mirroring the "coming up" copy already used client-side in
  `derive.reminders()` — but only decides *whether* lead applies at all
  (`settings.Lead > 0`), not whether the block that fires uses it; that
  decision moves to fire time.
- `backoffFireAt(due, stage, lead)` gains a `lead time.Duration` parameter,
  applied only at `stage == 0` (`due.Add(-lead)`); stages 1-2 (backoff
  retries) are unaffected — once a reminder is already overdue, retries
  keep firing due-phrased with no early heads-up, matching the client's
  `overdue` fallback.
- The actual `Title`/`Body` swap happens in the `time.AfterFunc` callback
  right before `sendFamily`, checking `time.Now().Before(reminder.DueAt)` —
  not earlier, at `resolveScheduled()` time — because a lead-scheduled fire
  can still land after `DueAt` in practice (a stuck process resuming late,
  a delayed tick), the same race the client's own `overdue` check at actual
  notify time exists to catch.
- Quiet-hours filtering keeps its current split: `familyReminders()`'s own
  `isQuietAt` check (based on the true due time) is left untouched to avoid
  touching already-tested behavior for every existing `lead: 0` caller;
  `resolveScheduled()`'s existing `isQuietAt(fireAt, ...)` check (already
  there for backoff retries) is the one that actually governs the
  lead-adjusted fire time. Known limitation, out of scope for this plan: a
  reminder due right at a quiet-hours boundary with a nonzero lead can be
  dropped by the due-time check even though its lead-shifted fire time
  would fall outside quiet hours. Narrow edge case; fixing it means
  reworking quiet-hours filtering to run once instead of twice, a
  refactor unrelated to the away-block feature.

## Out of scope

- Retroactively reconciling insight data after the fact if an away block
  is logged well after it happened (edited/backfilled) — the exclusion
  logic recomputes from current state every time it runs, so a late
  backfill just takes effect on the next render. No migration needed.
- Auto-detecting away time from absence of logs — this is explicit,
  user-initiated only.
