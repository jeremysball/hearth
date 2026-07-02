# Dogfood Remaining Work Handoff — 2026-07-02

Durable handoff for the full dogfood sequence from `2026-07-01-dogfood-triage.md`.

## Current Branch State

- Branch: `feat/split-datetime-inputs`.
- Latest commit: `036d2a5 feat(sheets): split datetime-local inputs into separate date + time fields`.
- Dogfood-related reload safety changes are in `js/app.js` and `js/ui.js` pending commit.
- Caching documentation is in `docs/caching-strategy.md` pending commit.
- `docs/remaining-work.md` is stale; use this file for dogfood status.

## Dogfood Triage Status

### Complete

- Sleep reopen bug: `356d74a fix(sleep): reopen an entry when the Woke field is cleared`.
- Pull-to-refresh release glitch: `1053cd3 fix(ptr): ease the release snap and fix the spinner rotation restart`; strengthened by `477b025`.
- Logged-by profile photo: `b4b22eb feat(app): show caregiver photo next to Logged by in entry detail`.
- Note indicator: `f6453be feat(home): show a dot when a log row's entry has a note`; follow-up `3766e6c`.
- Diaper rash flag: `ab38670 feat(diaper): add a rash toggle to the diaper form`; follow-up `55ccbfc`.
- Configurable play types: `9c5c8a4 feat(play): add a configurable list of play types`; sync fix `55b9520`; test `5f9b079`.
- Mixed diaper wet/dirty sizes: `a92d36d feat(diaper): split wet/dirty size for Mixed diapers`; fix `2f716bd`.
- Split date and time inputs: `036d2a5 feat(sheets): split datetime-local inputs into separate date + time fields`.

### In Progress

- Service-worker update reload safety:
  - Problem: `controllerchange` forced `window.location.reload()` immediately, which kicked users out of open bottom sheets during deploys.
  - Current change: `js/app.js` defers reload while `#scrim.show` exists and shows `toast('Update ready', reloadNow, 'Refresh')`; it auto-reloads once the sheet closes.
  - Current support change: `js/ui.js` allows `toast(msg, undo, label = 'Undo')` so the update toast can say `Refresh`.
  - Needs final verification, version bump, commit, push, and PR review.

- Caching/service-worker documentation:
  - `docs/caching-strategy.md` documents the cache layers, version bump, `sw.js` no-store header, install-time `cache: 'reload'`, deferred reload behavior, and SSE streaming headers.
  - Commit with this dogfood PR unless it gets split into a separate docs-only PR.

### Open From Original Dogfood Triage

- Manage caregivers: remove/promote.
  - Needs a permission model first. Current `caregivers.role` is a display label, not an authorization tier.
  - Needs endpoint design for removal/promotion, session invalidation for removed caregivers, and a decision to preserve attribution on existing entries.
  - Treat as its own design pass before implementation.

## Verification Already Run In Latest Session

- `node --check js/app.js && node --check js/ui.js` passed on 2026-07-02.
- `node --check js/app.js && node --check js/ui.js && node --check js/sheets.js` passed in the prior session.
- `npm run check` completed with 0 errors and 2 existing warnings on 2026-07-02:
  - `js/growth.js`: unused `unit`.
  - `js/sleep-edge-cases.test.js`: unused `updateEntry`.
- `node --test js/*.test.js` passed on 2026-07-02.
- `CHROMIUM=/usr/bin/chromium node tests/datetime-split.test.js` passed on 2026-07-02.
- Full Playwright command timed out after 300s in the prior session.
- Full Playwright completed on 2026-07-02 with unrelated failures: 166 pass, 4 fail.
  - `tests/adr0002-haptics.test.js`: fling haptic count mismatch.
  - `tests/play-types.test.js`: empty play-types list expectations failed.
  - `tests/spinner.test.js`: tap-without-drag kept `0` instead of expected `120`.

## Next Steps

1. Verify the reload behavior manually or with a targeted Playwright test if practical:
   - Open a bottom sheet.
   - Trigger `controllerchange` or simulate the handler path.
   - Confirm no immediate reload occurs while the sheet is open.
   - Confirm the `Refresh` toast appears and reloads on click.
   - Confirm reload happens after the sheet closes if the user ignores the toast.
2. Re-run any final verification needed before merge:
   - `node --check js/app.js js/ui.js`
   - `npm run check`
   - `node --test js/*.test.js`
   - Relevant Playwright suite or full `CHROMIUM=/usr/bin/chromium npm test` if feasible.
3. Run `scripts/bump-version.sh` before committing because cached frontend assets changed.
4. Commit intended files only: `js/app.js`, `js/ui.js`, `index.html`, `sw.js`, `docs/caching-strategy.md`, and this handoff.
5. Push `feat/split-datetime-inputs`, open a PR, and get GLM 5.2 review.

## Do Not Lose

- The core user-facing bug is deploy-triggered reload during forms. The fix should protect in-progress bottom-sheet interactions from service-worker update reloads.
- Do not revert the completed split-date/time work on this branch.
- Do not treat caregiver management as a quick frontend button; model permissions first.
