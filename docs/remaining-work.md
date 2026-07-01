# Remaining Work

Last refreshed: 2026-07-01 on `feat/entry-author` after the web-push implementation.

## Completed On This Branch

- **Entry author detail (`ui-polish` Task 3):** sync stamps `caregiverId` from `log_entries.created_by`, new local entries carry `currentCaregiverId`, the entry detail sheet renders `Logged by ...`, and `tests/entry-author.test.js` covers the visible detail.
- **Feed volume trend (`ui-polish` Task 4):** `derive.todayStats()` reports `feedVol`, Trends shows average feed volume and a feed-volume chart, and `tests/feed-volume.test.js` covers both total and seven-day average values.
- **Web push reminders (`notifications-sync-reminders` Task 1):** server stores Push API subscriptions, exposes VAPID public-key and subscribe endpoints, schedules bottle and medicine reminder pushes, removes gone endpoints, and the service worker handles `push` plus `notificationclick`.
- **Flaky PTR test:** fixed on `main` in `eb33b50` with an rAF wait before `pointerup`.

## Open Work

### Prose Sweep / Em-Dash Removal (`ui-polish` Task 5)

Plan: `docs/superpowers/plans/2026-06-30-ui-polish.md:1058`.

Prompt: `docs/superpowers/prompts/2026-07-01-prose-sweep.md`.

Scope:
- Search user-facing app copy, README, and docs for unclear prose and em dashes.
- Keep behavior, routes, storage, APIs, and tests unchanged except for copy expectations.
- Run `npm run check` and touched tests.
- Run `scripts/bump-version.sh` if cached frontend assets change.

## Merge Notes

- After this branch merges, the planned work list should contain only the prose sweep unless new dogfood issues appear.
- Stale remote branches noted in the previous version of this file were already merged and can be deleted when convenient.
