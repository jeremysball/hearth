# Hearth Codebase Quick Reference

A dense orientation doc for new sessions. Read before exploring files.

---

## Architecture

- **Vanilla JS PWA + Go + SQLite. No framework.** ES modules in `js/`, single `index.html`, `styles.css`, `sw.js`.
- **Views are functions that return HTML strings** injected into `#view`. Call `router.go(name)` (full render + `initThumbs`) or `router.refresh()` (re-render current view).
- **All user events are delegated** through one `click` handler in `app.js`, dispatched via `data-action="verb:noun"` on elements. Swipe/drag handled separately.
- **State lives in `store.js`**: a single `_state` object, loaded from `localStorage` via `load()`, mutated by exported helpers, persisted by `save()`. Access read-only via `state()`.
- **Sheets (bottom drawers)** are opened via `sheet.open(html, opts)` from `ui.js`. Log-entry and card-config sheets are in `sheets.js`.
- **Go server** handles auth (Tailscale session + optional OAuth), sync, SSE push, and serves the embedded frontend binary. Schema is applied with `CREATE TABLE IF NOT EXISTS` on every startup: no migration runner.

---

## JS File Map

| File | Purpose |
|------|---------|
| `app.js` | Shell, router (`router.go/refresh/boot`), event delegation, PWA init, global binders |
| `store.js` | State (`state()`), persistence (`save()`), log helpers (`addEntry`, `removeEntry`, `updateEntry`), derived data (`derive`), normalization |
| `ui.js` | DOM helpers (`$`, `$$`, `esc`), formatters (`fmt`), icon helper, sheet machinery (`sheet.open/close`), toast, theme, `nowLocalDT`, `initThumbs`, `positionThumb` |
| `sheets.js` | Log-entry bottom sheet (`openLog`, `saveLog`, `openTypeChooser`), card-config sheets (`editCard`, `openMedCard`, etc.), spinner (`openSpinner`) |
| `home.js` | Home screen view: hero awake timer, card grid, today summary |
| `sky.js` | Hero sky scene: palette/moon/sun math, scene HTML builder, canvas particle engine (`initSky`) |
| `sleep.js` | Sleep view |
| `trends.js` | Trends view |
| `growth.js` | Growth view + chart |
| `profile.js` | Profile/settings view, caregiver management |
| `timeline.js` | Timeline view with day-grouped filterable log |
| `onboarding.js` | First-run onboarding flow |
| `join.js` | Caregiver join-via-invite flow |
| `account.js` | OAuth sign-in/sign-out, conflict resolution UI |
| `sync.js` | Outbox queue, sync fetch, SSE listener |
| `reminders.js` | Push notification permissions and scheduling |
| `fx.js` | `animateGrow`, `buzz` (haptics), `chime`, `tick`, `confetti` |
| `log.js` | Dev-only logging helper |

---

## Key Exported Functions (grep to find exact line)

**`store.js`**
- `state()`: returns the live `_state` object (read-only by convention)
- `save()`: writes `_state` to `localStorage`
- `addEntry(e)`, `removeEntry(id)`, `updateEntry(id, patch)`: log mutations
- `normalizeSettings(s)`: coerces legacy `clock24` boolean → string, in-place; called inside `load()`
- `normalizeLog(log)`: fixes swapped sleep start/end
- `derive`: object of computed getters (last sleep, last feed, awake time, etc.)
- `wakeWindowRange(position)`: age-appropriate awake window `{low, high, midpoint, ...}` in minutes
- `ageLabel()`: human-readable age string
- `applySyncResponse(resp)`: merges server sync data into state
- `enqueueBabySync()`, `enqueueSettingsSync()`: mark items for next sync

**`ui.js`**
- `$('#sel')`, `$$('.sel')`: querySelector shortcuts
- `esc(s)`: HTML-escape a string
- `fmt.clock(d)`, `fmt.dur(min)`, `fmt.rel(d)`, `fmt.vol(ml)`: formatters
- `sheet.open(html, opts)`, `sheet.close()`: bottom drawer
- `toast(msg, undoFn?)`: transient toast notification
- `nowLocalDT()`: returns `YYYY-MM-DDTHH:MM` in local time
- `dtToISO(local)`, `isoToLocalDT(iso)`: datetime conversion helpers; `sheets.js` splits/joins this combined string across a paired `<input type="date">` + `<input type="time">` (see `dtPair`/`readDT`/`writeDT` in `sheets.js`) rather than using a single `datetime-local` input
- `initThumbs(container)`: initialise all `.seg-thumb` elements under container
- `positionThumb(group)`: position a single segmented-control thumb
- `applyTheme()`: read `state().baby.theme` and set CSS vars
- `icon(name)`: returns `<svg class="icon"><use href="#name"></use></svg>`

**`app.js`**
- `router.go(view)`: full nav to named view + `initThumbs`
- `router.refresh()`: re-render current view + `initThumbs`
- `router.boot()`: inject shell HTML (tabs + `#view`)

**`sky.js`**
- `moonPhase(date)`, `sunPosition(elapsedMin, highMin)`, `skyPalette(elevation)`: pure scene math
- `sceneSpec(inputs)`: maps hero status to a scene mode (`morning`/`day`/`golden`/`twilight`/`night`/`deep-night`/`newborn`)
- `emberGlow(heat)`: pure color/opacity/size for the hero card's ambient ember field (replaces the old 16-coal bed)
- `heroSky(st, sp)`: scene HTML + `--light-x/--light-y` card style for `home.js`'s hero
- `initSky()`: sizes the particle canvas and schedules events; called by the router after every render
- No landscape: the scene is sky only (sun/moon/clouds/stars), no ridges, no house
- **Assets:** `assets/sky/moon.webp` (moon disc), `cloud-tower.webp`/`cloud-classic.webp`/`cloud-hazybank.webp` (c1/c2/c3 cloud shapes), `sun-starburst.webp` (ray field). All are opaque grayscale WebP used as SVG `<mask>` luminance sources, never as final-color images; color always comes from `skyPalette()`.

---

## Go Server File Map (`server/`)

| File | Purpose |
|------|---------|
| `main.go` | Entry: load config, open DB, build mux, serve |
| `router.go` | `newRouter()`: wires all HTTP routes |
| `db.go` | `openDB()`: opens SQLite, runs schema, returns `*sql.DB` |
| `schema.sql` | Authoritative schema; applied idempotently on every startup |
| `auth.go` | Session cookie auth, `requireAuth` middleware |
| `oauth.go` | OAuth begin/callback routes via `markbates/goth` (Google + Apple) |
| `sync.go` | `/api/sync`: pull/push log entries and settings |
| `sse.go` | Server-sent events hub for real-time caregiver push |
| `entries.go` | Log entry CRUD endpoints |
| `caregivers.go` | Caregiver list/remove endpoints |
| `invites.go` | Invite-link create/join endpoints |
| `family.go` | Family record endpoints |
| `me.go` | `/api/me`: current user/session info |
| `push.go` | Web Push subscription endpoints and reminder scheduler |
| `reconcile.go` | Data-safe conflict reconciliation during OAuth link/restore |
| `config.go` | `loadConfig()`: reads env vars into `Config` struct |
| `testutil_test.go` | `newTestDB()`: in-memory SQLite for Go tests |

---

## Testing

`npm test` runs everything (lint, unit, Go, and Playwright E2E) via
`tests/run.js`. CI runs the same four legs in parallel as a matrix
(`.github/workflows/ci.yml`). Use the standalone commands below to run just
one thing while iterating:

```bash
# Unit tests (node:test), run a single file or all:
node --test js/store.test.js
node --test js/*.test.js
npm run test:unit           # all unit suites, no lint/go/e2e

# Playwright E2E only (builds the Go binary, runs all suites):
npm run test:e2e
node tests/spinner.test.js  # single suite

# Go tests:
go test ./server

# Type / lint check:
npm run check   # node --check on all JS + eslint

# Everything (what CI runs, minus the parallel matrix):
npm test
```

---

## Dev Scripts

- `scripts/bump-version.sh`: cache-buster version bump (see below).
- `scripts/sky-phases.js`: screenshots the hero sky scene in all 7 modes (morning/day/golden/twilight/night/deep-night/newborn) against a running dev server. Run after any `js/sky.js` change to compare before/after across the whole scene set: `BASE_URL=https://localhost:9878 OUT_DIR=/tmp node scripts/sky-phases.js` (server must already be running; see the `run` skill).

---

## Version Bump (required before every frontend commit)

Two files, one timestamp, must match:

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# In index.html: <meta name="version" content="TIMESTAMP">
# In sw.js:      const VERSION = 'hearth-TIMESTAMP';
```

**Only bump when a cached user-facing asset changes** (`js/`, `index.html`, `styles.css`, `sw.js`, `assets/`, `icons/`). Go-only or test-only diffs skip the bump.

---

## Design Constraints

- **Lucide icons only**: vendored as inline SVG sprite in `index.html <body>`. Never load external icon fonts.
- **Fonts:** Playfair Display for baby name + hero timer; Archivo for everything else.
- **Shape language:** pills for controls, large radii for cards, circles for identity/avatars.
- **Animations:** one ambient concept at a time. Fire system (`fire-a/b/c`) is the explicit exception (three coprime keyframes = one fire effect).
- **No external stylesheets**: all CSS in `styles.css` and `<style>` blocks in `index.html`.
- **Hero sky scene** (`js/sky.js`): sun position = wake-window fraction. Continuous motion is compositor-only; the canvas rAF loop runs only while a particle is live. The scene replaces the old hero moon glow and the red overtired pulse.
