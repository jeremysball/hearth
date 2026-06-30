# Hearth — UI Polish

**Date:** 2026-06-30
**Status:** Approved

---

## 1. Profile picture upload

### Goal

Each caregiver can upload a photo that identifies them on log entries.

### Design

The baby photo already works: `profilePhoto()` (`js/app.js:520`) reads a file, crops to 240×240 on a canvas, stores `cv.toDataURL('image/jpeg', 0.82)` on `state().baby.photo`, and syncs via `enqueueBabySync()`. Mirror this for caregivers.

Store as base64 JPEG in SQLite — no server file mounts, local-first. Add a `photo TEXT` column to `caregivers` (`server/schema.sql`). Expose it through a new `PATCH /api/caregivers/me` handler that updates `caregivers.photo` scoped to `sessionFrom(r).CaregiverID`. Include `{ id, displayName, role, photo }` in the `/api/sync` response whenever `caregivers.updated_at > since`.

Client: add `caregiverPhoto()` in `js/app.js` reusing the canvas crop from `profilePhoto()`, then POST to `/api/caregivers/me`. The caregiver row in `js/profile.js` (line 107, `caregiverRow`) currently renders name and role only — add an avatar thumbnail and an edit affordance. Cache photo alongside `cachedCaregivers` (`js/profile.js:93`).

Keep JPEG at 240×240, quality 0.82, matching the baby photo.

### Touched Code

- `server/schema.sql`: `photo TEXT`, `updated_at TEXT` on `caregivers`.
- `server/caregivers.go`: `PATCH /api/caregivers/me`; include `photo` in `handleListCaregivers`.
- `server/sync.go`: add `caregivers` array to `syncResponse`.
- `js/store.js`: extend `applySyncResponse` to merge caregivers into state.
- `js/app.js`: `caregiverPhoto()`, wire `cg:photo` action.
- `js/profile.js`: avatar in `caregiverRow`, upload affordance.

### Verification

- Upload a photo on device A. It appears in the caregiver list on device B after sync.
- Go test: `PATCH /api/caregivers/me` round-trips through sync response.

---

## 2. In-app changelog

### Goal

Parents see what changed in Hearth without leaving the app.

### Design

Add a Changelog section at the bottom of the Profile tab. Author it as a static JS module — versioned with the bundle, no backend needed.

Create `js/changelog.js` exporting `{ date, version, changes: string[] }[]` in descending order. `version` ties to the `<meta name="version">` content so entries align with shipped builds. Render in Profile as a card list grouped by date. Short entries, active voice, no em dashes, plain text (no markdown rendering).

Add a `seenChangelog` field to `DEFAULT().settings` in `js/store.js`, initialized in `normalizeSettings`. When the running version differs from `seenChangelog`, show a badge dot on the Profile tab icon. Tapping opens Profile and scrolls to the changelog card, which sets `seenChangelog` to the current version and clears the badge.

### Touched Code

- `js/changelog.js`: new module — data array and render function.
- `js/profile.js`: changelog card, scroll target.
- `js/store.js`: `seenChangelog` in `DEFAULT().settings` and `normalizeSettings`.
- `js/app.js`: badge dot on Profile tab when version differs.
- `index.html`, `sw.js`: add `js/changelog.js` to shell cache, bump version.

### Verification

- Fresh build with new version: Profile tab shows badge. Opening the changelog card clears it.
- Playwright test: badge present on load, gone after tapping changelog.

---

## 3. Who-logged-it indicator

### Goal

Show which caregiver logged each entry. Visible only inside the entry detail sheet.

### Design

`log_entries.created_by` already exists (`server/schema.sql:58`, written in `server/entries.go:39`). The sync response omits it today. Two changes surface it on the client:

1. **Server injects `caregiverId` into sync payload.** In `handleSync` (`server/sync.go:17`), read `created_by` alongside `payload_json` for each non-tombstoned entry and merge `{ "caregiverId": created_by }` into the JSON before appending to `resp.Entries`. No schema change needed.
2. **New entries carry `caregiverId` from the client.** `addEntry` (`js/store.js:81`) attaches the current caregiver id (from synced caregiver state) to every new entry so the local UI shows the author before the next sync.

Render a subtle "Logged by ${displayName}" line in the entry detail sheet (`openEntry`, `js/app.js:109`), below the title row. Look up `e.caregiverId` in cached caregiver state. Omit the line for legacy entries that lack `caregiverId`. Keep it out of `logRow` (`js/home.js:50`) and the timeline — home surfaces stay uncluttered.

### Touched Code

- `server/sync.go`: read `created_by` in entries query, merge `caregiverId` into payload.
- `js/store.js`: attach `caregiverId` in `addEntry` and `updateEntry`; cache caregivers from `applySyncResponse`.
- `js/app.js`: "Logged by" line in `openEntry`.

### Verification

- Two caregivers: A logs a bottle, B opens the entry detail and sees "Logged by A".
- Legacy entries without `caregiverId` show no line.
- Go test: `handleSync` returns `caregiverId` on entries.
- Playwright test: detail line renders when id present, absent when missing.

---

## 4. Feed volume trend

### Goal

Show daily feed volume (bottle + pump) so parents can track intake over time.

### Design

`derive.todayStats` (`js/store.js:350`) already sums `bottleVol` from bottle entries. Add a new `feedVol` field summing `amount` over entries whose `type` is `bottle` or `pump`. Keep `bottleVol` for backward compat.

In the Trends tab (`js/trends.js`):
- Add a `Avg feed vol / day` stat card to the `stat-grid` (line 35) using `fmt.vol(avgFeedVol)`.
- Add a "Feed volume" bar chart after the existing bottle volume chart (line 55): `barChart(week, 'feedVol', 'ml', (v) => fmt.vol(v), 'feed')`.

### Touched Code

- `js/store.js`: `feedVol` in `derive.todayStats`.
- `js/trends.js`: stat card and chart card.

### Verification

- Log a 120ml bottle and a 90ml pump on the same day. Feed volume chart reads 210ml; stat average updates.
- Switch volume unit to oz in Profile. Chart and stat render in oz.
- Playwright test: log entries, assert chart bar height and value text.

---

## 5. Prose sweep: concision rules and em dash removal

### Goal

Every human-readable string in the repo follows active voice, positive form, and no needless words. No em dashes anywhere.

### Design

Execute as a grep-driven per-file review, not a global find-and-replace. Em dash removal requires sentence restructuring (comma, colon, or two sentences) — never a hyphen substitution.

1. **Find em dashes.** `rg -n $'—' .` across JS, CSS, HTML, Go, and docs. Restructure each match.
2. **Audit UI copy.** Focus on `js/home.js` hero sub-copy (lines 181–184), `js/onboarding.js`, `js/sheets.js` form labels, `js/profile.js` section labels, and the regression banner copy (`js/home.js:108`).
3. **Audit file-top comments.** Rewrite any sentence opening with "It is", "There are", "In order to", or "Note that" across `js/*.js` and `server/*.go`.
4. **Docs.** `CLAUDE.md`, `README`, and `docs/` — same rules.

Ships as its own PR.

### Verification

- `rg $'—' .` returns zero matches.
- Manual read of the four focus JS files confirms active voice throughout.
- `CHROMIUM=/usr/bin/chromium npm test` passes with no label text assertion failures.
- Bump `index.html` and `sw.js` version.
