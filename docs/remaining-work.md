# Remaining Work — Get Every Branch Finished and Merged

Last refreshed: 2026-07-01. Status reflects `main` at `dd46974` plus the two live worktrees.

## Where things stand

`main` is at `dd46974`, clean, in sync with `origin/main`. Two worktrees hold unmerged work; everything else is merged and pruned.

One known-red test on `main`: `node --test js/store.test.js` → `wakeWindowRange returns correct bracket for a 4-month-old` fails. The test is right; the code has a latent `ageMonths` UTC-parse bug (date-only birthdate parsed as UTC, rolling the month back in negative timezones and selecting the wrong wake-window bracket). The fix already exists in the `ui-polish-design` worktree as commit `682423c` — merging that branch is what turns the suite green. Until then, `main` ships the bug.

## Branch 1 — `fix/sync-foreground-overdue-labels`

Plan: `docs/superpowers/plans/2026-06-30-sync-foreground-overdue-labels.md`
Worktree: `.worktrees/sync-overdue-labels`, HEAD `b75f03b`.

| Task | State |
|---|---|
| 1 — Overdue card labels | ✅ committed (`520a14b`), `tests/overdue-labels.test.js` 5/5 passing |
| 2 — Live 15s tick | ✅ committed (`b75f03b`) |
| 3 — `visibilitychange` + 15s poll | 🔧 implemented but uncommitted; `tests/visibility-sync.test.js` written (38 lines) and untracked |
| 4 — Full-suite verification + push | ⏳ not done |

### To finish

1. Stage and commit Task 3 in the worktree:
   ```bash
   ./scripts/bump-version.sh
   git add js/app.js tests/visibility-sync.test.js index.html sw.js
   git commit -m "fix(sync): pull on visibilitychange and reconnect stale SSE"
   ```
2. Run the new suites together, then the full Playwright suite (broad `js/app.js` change → full suite per `CLAUDE.md`):
   ```bash
   node tests/overdue-labels.test.js && node tests/visibility-sync.test.js
   CHROMIUM=/usr/bin/chromium npm test
   ```
3. Push and open a PR, or push straight to `main` and push, then fast-forward the main checkout:
   ```bash
   git push -u origin fix/sync-foreground-overdue-labels
   gh pr create --fill
   # after merge: from the main checkout
   git pull --ff-only origin main
   ```
4. Remove the worktree and delete the branch once merged.

### Manual checks the spec calls for (can't automate)

- Toggle device network off/on while SSE is connected, then foreground the app and confirm `/api/events` reconnects.
- Log a bottle, wait past the 3h interval with the app open; confirm the card flips from "Next bottle · every 3h" to "Bottle due · X min ago" and advances within 15s.
- Two-device sync: log on device A, background device B 2 min, foreground B; entry appears within 2s.

## Branch 2 — `ui-polish-design`

Plan: `docs/superpowers/plans/2026-06-30-ui-polish.md`
Worktree: `.worktrees/ui-polish-design`, HEAD `682423c`. Carries the `ageMonths` UTC fix in `682423c`.

| Task | State |
|---|---|
| 1 — Caregiver photo sync | ✅ committed (`6ddc622`) |
| 2 — In-app changelog | ✅ committed (`ece0044`), `js/changelog.js` + `tests/changelog.test.js` 4/4 passing |
| 3 — Entry author detail | 🚧 partial, uncommitted |
| 4 — Feed volume trend | ⏳ not started (no `feedVol` anywhere) |
| 5 — Prose sweep / em-dash removal | ⏳ not started |

### Task 3 specifics (what's done vs. missing)

Done:
- `currentCaregiverId` flows through sync (`server/sync.go:18,27`; `js/store.js:647`).
- `caregiverPhoto()` helper in `js/app.js:557` resolves a caregiver id.
- `seenChangelog`/`feedVol`/`caregiverId` scaffolding in `js/store.js`.

Missing (per plan Task 3, `docs/superpowers/plans/2026-06-30-ui-polish.md:705`):
- `server/sync.go` does not inject `caregiverId` into individual entry payloads — only `currentCaregiverId` at the top level. The uncommitted `TestHandleSyncInjectsCaregiverIDIntoEntries` in `server/sync_test.go` (+26 lines) expects it.
- New local entries in `js/store.js`/`js/app.js` do not stamp `caregiverId`.
- No `.entry-author` rendering in `js/app.js` or `styles.css`.
- No `tests/entry-author.test.js`.

### To finish

1. In the worktree, complete Task 3 server side: have `handleSync` stamp each entry JSON with `caregiverId` from `log_entries.created_by` (the uncommitted test already pins the shape). Run `cd server && go test ./...`.
2. Stamp `caregiverId` on new entries in `saveLog`/`js/store.js` and pass it through `js/app.js`.
3. Render the `.entry-author` line in the entry detail sheet only when a matching author exists; add the styles.
4. Write `tests/entry-author.test.js` per the plan and run it.
5. Task 4 — add the feed volume stat + chart to `js/trends.js` (`feedVol`); write its test.
6. Task 5 — repo-wide prose sweep; remove em dashes per the global constraint.
7. Before any commit touching `js/`/`index.html`/`sw.js`: `./scripts/bump-version.sh`.
8. Run unit + the Playwright suites for the touched JS view files; the `js/app.js`/`store.js` changes are broad, so run the full `CHROMIUM=/usr/bin/chromium npm test`.
9. Push, open PR, merge, fast-forward main, remove worktree, delete branch.

### Why this branch should merge soon

It carries the only fix for the `ageMonths` UTC-parse bug. Until it merges, `main`'s `node --test js/store.test.js` is red and any caregiver in a negative timezone gets the wrong wake-window bracket.

## Plan-level leftovers (no branch yet)

- **`2026-06-24-embed-frontend-assets` — Task 2** never shipped. Only `schema.sql` is `go:embed`ded; the binary still needs `STATIC_DIR` to serve `index.html`/`js/`/`styles.css`. Without it, single-binary deploys don't serve the PWA. Land this (embed the frontend, keep `STATIC_DIR` as the dev override) before treating the server as self-contained.
- **`2026-06-30-notifications-sync-reminders` — Task 1** (web push) is untouched: no `server/push.go`, no VAPID, no `push_subscriptions` table. Its Tasks 2 and 3 split into the `fix/sync-foreground-overdue-labels` branch covered above, so once that merges only the web-push half remains. Needs VAPID key generation and a server-side push scheduler; see the plan for the exact schema and handlers.

## Worktrees and branches after pruning

Live (have unmerged work):
- `.worktrees/sync-overdue-labels` → `fix/sync-foreground-overdue-labels`
- `.worktrees/ui-polish-design` → `ui-polish-design`

Pruned (merged; worktrees and local branches removed 2026-07-01): `feat/phase2-sleep-model`, `feat/ios-picker`, `sleep-edge-cases`, `fix/sync-refresh`, `onboarding-timeline-polish`, plus three `worktree-*` placeholders. Their remote branches still exist on `origin` and can be deleted with `git push origin --delete <branch>` if you want them gone.

## Recommended order

1. Finish + merge `fix/sync-foreground-overdue-labels` — smallest, mostly done, unblocks reliable partner sync.
2. Finish + merge `ui-polish-design` — turns the unit suite green and lands the caregiver photo + changelog features already built.
3. Open a fresh branch for `embed-frontend-assets` Task 2 — enables single-binary deploys.
4. Open a fresh branch for the web-push half of `notifications-sync-reminders`.