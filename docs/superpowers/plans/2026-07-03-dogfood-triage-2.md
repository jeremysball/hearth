# Dogfood Triage — 2026-07-02 list (triaged 2026-07-03)

Raw feedback from dogfooding on 2026-07-02, triaged against the current codebase. Hero-card
overhaul is **excluded** — already being handled separately (branch `feat/hero-sky-scene`).
Estimates below are grounded in file/line pointers, not guesses.

---

## Quick fixes (well-scoped, no open design questions)

### Toast dismissible
No dismiss affordance exists today (`js/ui.js:214-226`) — only an optional Undo button per-toast.
Add a close (X) tap target, or a swipe-to-dismiss, in `toast()` plus a handler in `app.js`'s
action map (pattern like `'toast:undo'` at `app.js:272`).

### Developer-mode progress toasts
`tapVersion()` (`js/profile.js:22-31`) is silent for taps 1-9, only the caller
(`app.js:265`) toasts on the 10th (successful) tap. Change `tapVersion()`'s return to also
report remaining-taps-count, and toast "Press N more time(s)..." on the intermediate taps.
Exactly matches the request — no ambiguity.

### Default bottle size setting
Bottle amount stepper currently hardcodes `120` (`js/sheets.js:459`). Same shape as the existing
`bottleIntervalH` default (`js/store.js:16`, edited via `editCard('bottle')` →
`saveBottle()` at `sheets.js:797-800`, synced like `meds`/`playTypes`). Add
`defaultBottleAmount` to the same settings row, wire it through sync (`store.js:715`,
`server/family.go`, `server/sync.go:40-50`) exactly like `bottleIntervalH` already is.

### Medicine "Add or edit" shortcut
Confirmed: editing an existing medicine log entry already re-selects the right med in the
dropdown (`prefill()`, `sheets.js:596`) — that part works. The actual gap is that managing the
*list* of medicines (`medForm()`, reachable only via the Home card's edit-pencil,
`sheets.js:670-671`) isn't reachable from inside the log-entry sheet. Play already solved this
with a "Manage play types" ghost button inline in its form (`sheets.js:485`,
`data-action="playtypes:open"`). Per your framing: medicine gets an inline "Add or edit" *option
inside the `<select>` itself* (not a separate button); other thumb-slider/segmented-control-based
user-content types (play now, hygiene once it exists) get play's ghost-button pattern. Both are
direct copies of existing code.

---

## Needs a small decision before scoping

### Diaper size rename (thumb/medium/big → little/medium/big) — DECIDED
Display-only mapping. Stored values stay `Small`/`Medium`/`Large` forever (`gather()` still
writes the literal string, `seg()` still uses it as both label and value internally) — add a
label-mapping layer at render sites only (`home.js:21-22`, timeline, and wherever `seg()` renders
button text for the diaper form specifically). Zero migration risk, no touch to `store.js` or
server payloads.

### Pull-to-refresh overshoot commit — DECIDED
Small overshoot: ~20px past `PTR_THRESHOLD` (70px), landing around 90-100px total drag distance
before auto-commit. `PTR_MAX` (`app.js:433`, currently 80, the visual cap) needs raising to match
the new auto-commit distance so the wrapper can visually travel there. Still need: exact
"shortly after crossing" timing (e.g. commit the instant the threshold is crossed vs. a small
grace/hold period) and whether a visual indicator (e.g. an icon or color change) marks the
overshoot zone — can decide those at implementation time unless you want to specify now.

### Hygiene activity structure — DECIDED
Multiple named sub-items, full medicine-style structure: settings list entry, per-item interval,
`TYPES` registry entry, form + dose-shortcut + management sheet, server column + sync payload,
server-side reminder scheduling — mirrors medicine's ~11 touchpoints (and play's, once it went
through the sync-bug fix) rather than the smaller generic-card path.

### Reminders per specific medicine/type — DECIDED (see "Reminders for every future loggable
activity" below, which supersedes and broadens this)

---

## Needs your input directly (can't resolve from code)

### Sleep detail fields — DECIDED (from Huckleberry screenshots, modeling their "Add sleep → Details" screen)
Current sleep form only has start/end/quality/note (`sheets.js:448-452`). New greenfield fields,
matching the reference screens:

- **Start-of-sleep mood:** `Upset` / `Content` — likely folds into or replaces the existing
  `quality` seg (`Restless`/`Okay`/`Good`/`Great` today) rather than adding a fully parallel field;
  decide at implementation time whether to keep both or collapse.
- **Time to fall asleep:** `Under 10 min` / `10-20 min` / `Long time to fall asleep` — new seg.
- **How it happened:** `On own in bed`, `Nursing`, `Worn or held`, `Next to carer`, `Co-sleep`,
  `Bottle`, `Stroller`, `Car`, `Swing` — new seg, 9 options, needs icons (Lucide substitutes since
  these are custom Huckleberry glyphs — crib, bottle, stroller, car, swing, person-holding, etc.).
- **End-of-sleep:** `Woke up child` (i.e. a reminder/alarm ended it), `Upset`, `Content` — new
  seg.
- All under a collapsible "Details — Optional" section, matching Huckleberry's UX of keeping the
  core sleep form fast and pushing this to an optional expandable block.

All fields are optional/nullable, matching how `quality` already isn't required today. Persisted
as new `base.*` fields in `gather()` (`sheets.js:497-500`) — free on the backend (JSON blob).

### Notification throttling schedule — DECIDED
Fire right at the reminder's due time, then re-fire at +15min if still missed, then +1hr after
that. Root cause is real and confirmed: the server has no persisted "already sent" state
(`server/push.go:157-209`), so every 5-minute `ScheduleAll()` tick (`server/main.go:42-48`) **or
any other entry logged anywhere in the family** (`server/entries.go:46`) recomputes an overdue
reminder's due-time and fires it again immediately — that's the "every 5 minutes" bug. Fix needs
persisted "last sent at" + "next backoff step" state per reminder key (new table/column, since
`s.pending`/`s.byFamily` are in-memory and wiped on fire/restart), with `familyReminders()`
(`push.go:241-281`) checking that state before re-scheduling instead of always recomputing from
raw due-time.

### "ADVISOR PLUGIN FOR OPENCODE"
Confirmed out of scope — separate project, not a Hearth feature. Dropped from this list.

### First account free, then invite-only — CLARIFIED, still needs a design pass
Not a multi-tenant "family" gate — one Hearth instance is one family, one baby, permanently. What
you actually want: the **first-ever caregiver** to hit a fresh instance provisions it (calls
`POST /api/family`, which is what creates the family/baby/first-caregiver row today, confirmed
fully open/unauthenticated at `server/family.go:29-95` — no `requireAuth`, no existing-family
check). Every caregiver after that must sign in via Google/Apple OAuth (already implemented,
`server/oauth.go`) and either match an existing caregiver identity or arrive with a valid invite
token (existing `pending_auth`/invite-join flow already handles the "new caregiver joining via
OAuth + invite" case per the 2026-06-27 accounts-and-oauth work).

So the actual gap is narrower than "gate signups" — it's:
1. `handleCreateFamily` needs to reject if a family already exists in this instance's DB (`SELECT
   COUNT(*) FROM families`), so the anonymous local-onboarding path can't run twice.
2. The client's onboarding flow needs to check "is this instance already provisioned?" and, if
   so, route straight to the Google/Apple sign-in screen instead of showing the
   create-family/baby-name form — need to find/confirm where that branch point lives client-side
   (not yet traced; do this as part of scoping the implementation).

### CI/CD — DONE (landed 2026-07-03, PR #43)
Shipped as `.github/workflows/ci.yml` (lint/unit/go/e2e matrix) and `.github/workflows/build.yml`
(GHCR publish), plus Watchtower auto-roll (`0ace351`) and the unified `tests/run.js` runner
(`3cec04c`). Matches the approved spec at
`docs/superpowers/specs/2026-07-02-ci-cd-design.md`.

### Reminders for every future loggable activity — DECIDED
Generic per-type reminders, not just per-med toggles. Needs the generic `derive.nextForType`
mechanism (already backing the generic home-card path, see the hygiene section above) wired into
`familyReminders()` (`server/push.go:241-281`), which today only computes bottle + meds — extend
it to loop over every configured activity type with a reminder interval, not just those two
hardcoded cases.

### Token hashing
Confirmed: session tokens, invite tokens, launch tokens, and `pending_auth` tokens are all stored
as raw plaintext strings in the DB (`server/auth.go:40`, `server/invites.go:23`,
`server/launch_tokens.go:25`, oauth pending-auth). They're generated via `crypto/rand`
(`server/auth.go:22`, `server/db.go:4`) so they're high-entropy — hashing them (e.g. SHA-256
before storage, compare hashes on lookup) protects against DB-dump exposure the same way
password hashing does, even though these aren't user-chosen secrets. Plan to hash all four token
tables.

### Dev no-cache env var + more aggressive default caching — NEW, not yet triaged
Suspected root cause of "girlfriend gets kicked out of bottom-sheet editing sometimes": on every
service-worker update, `reloadWhenSafe()`/the `controllerchange` handler (`js/app.js:760-777`)
waits only for the sheet (`scrim`) to close, then force-reloads the page immediately — no
warning, no save-in-progress check. Combined with the mandatory version bump on every
user-facing commit (cache-buster rule in `CLAUDE.md`), a live dogfooding session can get several
forced reloads, each one firing right as a sheet closes — reads exactly like being "kicked out."
Two asks, not yet scoped:
1. A developer "no cache" env var (server- or client-side, TBD) to disable this update/reload
   cycle entirely during active dev/dogfood sessions.
2. Make the *default* (non-dev) caching more aggressive/less trigger-happy, so real users see
   fewer disruptive reloads day-to-day.
Needs a design pass: what exactly "no cache" disables (skip SW registration? skip
`caches.match`/cache-first for assets? skip the reload-on-update logic specifically?), and how
much more aggressive the default caching should get (e.g. debounce/delay the reload further,
require an explicit "Refresh now" tap always rather than auto-reloading after the sheet closes).

### Research: Huckleberry premium sleep features — DECIDED, queued
Confirmed: do this research, as a standalone track separate from the PR sequence (no code
changes). Not started yet — say the word and I'll kick it off (WebSearch, not a subagent, unless
you'd rather I use one).

### LLM sleep insights
Still "too vibey" per your own framing — held until it has more shape. No action now.

### Future: hero card reacting to bad nights/sleep regressions
Explicitly "very in the future" per your note — no action, just logged here so it isn't lost.

---

## Suggested order

Everything below is decided and ready to sequence into PRs (`feat`/`fix` one per PR, per the
established [[project_dogfood_pr_sequence]] workflow — branch, GLM 5.2 review, merge).

1. Quick fixes: toast dismiss, dev-mode progress toasts, bottle default size, medicine
   add-or-edit shortcut.
2. Small/medium: diaper size relabel (display-only), PTR overshoot commit, sleep detail fields
   (Huckleberry-style), hygiene activity (full medicine-style structure).
3. Reminders/notifications: generic per-type reminders, notification backoff (due → +15min →
   +1hr with persisted sent-state).
4. Security/infra: token hashing, first-account/invite-only gating (narrow scope: block
   `handleCreateFamily` once a family exists + client routes to OAuth sign-in instead).
5. CI/CD: **done** — see above.
6. Research (parallel track, not PR-sequenced): Huckleberry premium features — queued, not yet
   started.
7. Deferred: LLM sleep insights (needs more shape first), hero-card reactivity to sleep
   regressions (future work, explicitly out of scope for now).
