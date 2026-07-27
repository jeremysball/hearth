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
top: look up the most recent `type='away'` entry for the family. If its
payload has no `end` and `start <= now` (ongoing), return no reminders at
all for that family — a babysitter isn't going to log a bottle. Reminders
resume automatically once the away entry gets an `end`, on the next
`ScheduleAll` tick or entry-triggered reschedule (both already exist, no
new plumbing needed).

## Out of scope

- Retroactively reconciling insight data after the fact if an away block
  is logged well after it happened (edited/backfilled) — the exclusion
  logic recomputes from current state every time it runs, so a late
  backfill just takes effect on the next render. No migration needed.
- Auto-detecting away time from absence of logs — this is explicit,
  user-initiated only.
