# Remaining Work — Get Every Branch Finished and Merged

Last refreshed: 2026-07-01 (post-merge). `main` is at `94a295a`, clean, in sync with `origin/main`. No live worktrees remain.

## Recently merged

- **`fix/sync-foreground-overdue-labels`** — all 4 tasks merged (`63c45d6`). Overdue card labels, 15s live tick, `visibilitychange` sync + stale-SSE reconnect, full-suite verification. `tests/overdue-labels.test.js` (5/5) and `tests/visibility-sync.test.js` (1/1) live on `main`.
- **`ui-polish-design`** — Tasks 1 (caregiver photo sync), 2 (in-app changelog), and the `ageMonths` UTC-parse fix merged (`64ed079`). `node --test js/store.test.js` is now green on `main`. Tasks 3 (entry author), 4 (feed volume trend), 5 (prose sweep) remain open — see below.

A flaky `adr0002-ptr.test.js` ("sync triggered after full pull release", "ptr-spinning class while sync in-flight") is **pre-existing on `main`**, confirmed by repeat runs (1/2/0 fails across three runs). Timing tolerances in that suite are too tight under load; it needs its own fix but is not a regression from any recent merge.

## Open plan work — needs a new branch

### Entry author detail (`ui-polish` Task 3)

Plan: `docs/superpowers/plans/2026-06-30-ui-polish.md:705`

Already on `main` from the merged worktree:
- `currentCaregiverId` flows through sync (`server/sync.go`, `js/store.js:647`).
- `caregiverPhoto()` helper in `js/app.js:557` resolves a caregiver id.
- `seenChangelog`/`feedVol`/`caregiverId` scaffolding in `js/store.js`.

Missing:
- `server/sync.go` does not stamp `caregiverId` onto individual entry payloads — only `currentCaregiverId` at the top level.
- New local entries in `js/store.js`/`js/app.js` do not stamp `caregiverId`.
- No `.entry-author` rendering in `js/app.js` or `styles.css`.
- No `tests/entry-author.test.js`.

To finish:
1. Have `handleSync` inject `caregiverId` (from `log_entries.created_by`) into each entry JSON; add/restore the Go test.
2. Stamp `caregiverId` on new entries in `saveLog`/`js/store.js`; pass through `js/app.js`.
3. Render `.entry-author` in the entry detail sheet only when a matching author exists; add styles.
4. Write `tests/entry-author.test.js`.

### Feed volume trend (`ui-polish` Task 4)

Plan: `docs/superpowers/plans/2026-06-30-ui-polish.md:909`. No `feedVol` work anywhere yet. Add a daily feed-volume stat + chart to `js/trends.js` and its test.

### Prose sweep / em-dash removal (`ui-polish` Task 5)

Plan: `docs/superpowers/plans/2026-06-30-ui-polish.md:1058`. Repo-wide prose cleanup; remove em dashes per the global constraint.

### Web push reminders (`notifications-sync-reminders` Task 1)

Plan: `docs/superpowers/plans/2026-06-30-notifications-sync-reminders.md:39`. Untouched: no `server/push.go`, no VAPID, no `push_subscriptions` table. Tasks 2 and 3 of that plan split into the now-merged `fix/sync-foreground-overdue-labels`, so only the web-push half remains. Needs VAPID key generation and a server-side push scheduler; the plan has exact schema and handlers.

### Flaky `adr0002-ptr.test.js`

Two timing-sensitive assertions (`sync triggered after full pull release`, `#ptr has ptr-spinning class while sync is in-flight`) flake under load on `main`. Loosen the timing tolerances or add retry/await logic in `tests/adr0002-ptr.test.js`.

## Worktrees and branches

No live worktrees. Stale remote branches still on `origin` (all merged): `feat/{ios-picker,phase2-sleep-model,log-request-insight,sleep-model-science}`, `fix/{sync-refresh,spinner-input}`, `perf/ptr-junk-fixes`, and two `worktree-*` placeholders. Delete with `git push origin --delete <branch>` when ready.

## Recommended order

1. `ui-polish` Tasks 3 → 4 → 5 on one new branch, then merge.
2. `notifications-sync-reminders` web-push half on a fresh branch.
3. Tighten the flaky `adr0002-ptr.test.js` tolerances.