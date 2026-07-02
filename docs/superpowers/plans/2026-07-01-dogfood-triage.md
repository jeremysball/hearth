# Dogfood Triage — 2026-07-01

Raw feedback from using the app, triaged against the current codebase. Not yet a task-by-task
implementation plan — this is groundwork for one. Effort/complexity estimates below are grounded
in the actual code (file/line pointers), not guesses.

**Key fact that shapes most of these:** log entries are stored as a JSON blob
(`payload_json` in `server/schema.sql:54-63`), so adding new fields to an entry (rash flag,
split diaper sizes, play type, etc.) needs zero backend migration — it's a frontend-only change.

---

## Quick fixes (bugs, do first)

### Can't save an empty time to reopen a sleep entry
Root cause confirmed: `gather()` in `js/sheets.js:479-480` only sets `base.end` when the
"Woke" field is non-empty. `updateEntry()` in `js/store.js:107-119` does
`Object.assign(e, patch)`, which never deletes a key that's absent from `patch`. So clearing
the "Woke" field and saving leaves the old `end` in place — the entry never goes back to
"ongoing." Falsy `e.end` is already the "still asleep" sentinel everywhere else in the
codebase (`sleep.js`, `home.js`, `store.js` derive logic).

**Fix:** in `gather()`, when the end field is empty, explicitly set `base.end = null`.
One-line change.

### Pull-to-refresh glitchy at release
Likely cause, `js/app.js:483-497`: on a successful pull (armed + released), the wrapper jumps
straight to `translateY(0)` with `transition: none` — no easing from wherever the finger let
go. The non-armed path (`ptrReset()`, same file ~436-458) already eases back out properly;
the armed/syncing path skips that treatment. Needs a closer look to confirm, but this is a
small, contained fix in the `pointerup` handler.

---

## Small additions (well-scoped, low risk)

### "Logged by" should show the pfp
`js/app.js:142` already renders "Logged by {name}" as plain text in `openEntry()`.
`js/profile.js:117-127` (`caregiverRow`) already has the avatar-with-photo-or-initial markup.
Reuse that pattern in the entry-detail sheet instead of building new avatar logic.

### Symbol to denote an entry has a note
`summary()` in `js/home.js:6-29` already has `e.note` available. Add a small icon/dot to the
row markup in `js/home.js` (~lines 55-63) and `js/timeline.js` (~lines 104-107) when
`e.note` is truthy.

### Diaper rash flag
Add a toggle/checkbox to the diaper form (`js/sheets.js:442-445`), thread it through
`gather()`/`prefill()`, surface it in the diaper branch of `summary()`. Free on the backend
(JSON blob).

---

## Medium

### Separate pee/poop size for Mixed diapers
Conditionally render two size selectors when `kind === 'Mixed'` instead of the current single
selector. Touches the diaper form, `gather()`, `prefill()` (`js/sheets.js:442-445, 479-480,
515`), and the diaper summary line. Open question: keep the single `size` selector for
Wet/Dirty and only split into `wetSize`/`dirtySize` for Mixed, or always split? Leaning toward
only splitting for Mixed, to avoid changing the common case's UI.

### Configurable play types
No type field exists on the play form today (`js/sheets.js:458`, just time + note). There's a
ready-made pattern to copy: the medicines list (`state().settings.meds`, `medForm()`/`medRow()`
in `js/sheets.js:668-688`) is already a user-managed add/remove list. Mirror that for
`settings.playTypes`, add a type selector to the play form, and show the type in `summary()`.

### Split date and time
Only two call sites use `<input type="datetime-local">`: the shared `timeRow()` and the sleep
form's start/end fields (`js/sheets.js:424, 430-431`). Swap each for a date input + time input
pair, update `gather()`/`prefill()`/`isoToLocalDT` to recombine them into ISO. Contained to one
shared helper, but touches every log form's markup and CSS layout — worth testing each entry
type after the change.

---

## Large — needs a decision before scoping

### Manage caregivers (remove, promote)
Not just a button to wire up. Today `caregivers.role` (`server/schema.sql:17-25`) is a
free-text label like "Parent," not a permission tier — there's no owner/admin concept that
distinguishes who's *allowed* to remove or promote whom. `server/caregivers.go` currently only
has list + self-photo-patch, no delete or role-change endpoint.

Before implementing, needs:
- A permission model (first caregiver = owner? anyone can remove anyone? self-only role edits?)
- A DELETE endpoint with session invalidation for the removed caregiver (their existing session
  token needs to stop working immediately)
- A decision on what happens to that caregiver's existing log entries (keep attribution, just
  drop their access)

Given "integrity and availability of user data above all else" is a stated project principle,
treat this as its own small design pass rather than folding it into the quick-fix batch.

---

## Suggested order

1. Quick fixes: sleep-entry empty-time bug, PTR release glitch
2. Small additions: logged-by pfp, note symbol, diaper rash flag
3. Medium: mixed-diaper pee/poop sizes, play types, split date/time
4. Large: caregiver management — design the permission model first, then implement
