# Hearth Codebase Quick Reference

A dense orientation doc for new sessions. Read before exploring files.

---

## Architecture

- **Vanilla JS PWA + Go + SQLite. No framework.** ES modules in `js/`, single `index.html`, `styles.css`, `sw.js`.
- **Views are functions that return HTML strings** injected into `#view`. Call `router.go(name)` (full render + `initThumbs`) or `router.refresh()` (re-render current view).
- **All user events are delegated** through one `click` handler in `app.js`, dispatched via `data-action="verb:noun"` on elements. Swipe/drag handled separately.
- **State lives in `store.js`** — a single `_state` object, loaded from `localStorage` via `load()`, mutated by exported helpers, persisted by `save()`. Access read-only via `state()`.
- **Sheets (bottom drawers)** are opened via `sheet.open(html, opts)` from `ui.js`. Log-entry and card-config sheets are in `sheets.js`.
- **Go server** handles auth (Tailscale session + optional OAuth), sync, SSE push, and serves the embedded frontend binary. Schema is applied with `CREATE TABLE IF NOT EXISTS` on every startup — no migration runner.

---

## JS File Map

| File | Purpose |
|------|---------|
| `app.js` | Shell, router (`router.go/refresh/boot`), event delegation, PWA init, global binders |
| `store.js` | State (`state()`), persistence (`save()`), log helpers (`addEntry`, `removeEntry`, `updateEntry`), derived data (`derive`), normalization |
| `ui.js` | DOM helpers (`$`, `$$`, `esc`), formatters (`fmt`), icon helper, sheet machinery (`sheet.open/close`), toast, theme, `nowLocalDT`, `initThumbs`, `positionThumb` |
| `sheets.js` | Log-entry bottom sheet (`openLog`, `saveLog`, `openTypeChooser`), card-config sheets (`editCard`, `openMedCard`, etc.), spinner (`openSpinner`) |
| `home.js` | Home screen view — hero awake timer, card grid, today summary |
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
- `state()` — returns the live `_state` object (read-only by convention)
- `save()` — writes `_state` to `localStorage`
- `addEntry(e)`, `removeEntry(id)`, `updateEntry(id, patch)` — log mutations
- `normalizeSettings(s)` — coerces legacy `clock24` boolean → string, in-place; called inside `load()`
- `normalizeLog(log)` — fixes swapped sleep start/end
- `derive` — object of computed getters (last sleep, last feed, awake time, etc.)
- `awakeWindowMin()` — returns age-appropriate recommended awake window in minutes
- `ageLabel()` — human-readable age string
- `applySyncResponse(resp)` — merges server sync data into state
- `enqueueBabySync()`, `enqueueSettingsSync()` — mark items for next sync

**`ui.js`**
- `$('#sel')`, `$$('.sel')` — querySelector shortcuts
- `esc(s)` — HTML-escape a string
- `fmt.clock(d)`, `fmt.dur(min)`, `fmt.rel(d)`, `fmt.vol(ml)` — formatters
- `sheet.open(html, opts)`, `sheet.close()` — bottom drawer
- `toast(msg, undoFn?)` — transient toast notification
- `nowLocalDT()` — returns `YYYY-MM-DDTHH:MM` in local time (for `<input type="datetime-local">`)
- `dtToISO(local)`, `isoToLocalDT(iso)` — datetime conversion helpers
- `initThumbs(container)` — initialise all `.seg-thumb` elements under container
- `positionThumb(group)` — position a single segmented-control thumb
- `applyTheme()` — read `state().baby.theme` and set CSS vars
- `icon(name)` — returns `<svg class="icon"><use href="#name"></use></svg>`

**`app.js`**
- `router.go(view)` — full nav to named view + `initThumbs`
- `router.refresh()` — re-render current view + `initThumbs`
- `router.boot()` — inject shell HTML (tabs + `#view`)

---

## Go Server File Map (`server/`)

| File | Purpose |
|------|---------|
| `main.go` | Entry: load config, open DB, build mux, serve |
| `router.go` | `newRouter()` — wires all HTTP routes |
| `db.go` | `openDB()` — opens SQLite, runs schema, returns `*sql.DB` |
| `schema.sql` | Authoritative schema; applied idempotently on every startup |
| `auth.go` | Session cookie auth, `requireAuth` middleware |
| `oauth.go` | OAuth begin/callback routes via `markbates/goth` (Google + Apple) |
| `sync.go` | `/api/sync` — pull/push log entries and settings |
| `sse.go` | Server-sent events hub for real-time caregiver push |
| `entries.go` | Log entry CRUD endpoints |
| `caregivers.go` | Caregiver list/remove endpoints |
| `invites.go` | Invite-link create/join endpoints |
| `family.go` | Family record endpoints |
| `me.go` | `/api/me` — current user/session info |
| `reconcile.go` | Data-safe conflict reconciliation during OAuth link/restore |
| `config.go` | `loadConfig()` — reads env vars into `Config` struct |
| `testutil_test.go` | `newTestDB()` — in-memory SQLite for Go tests |

---

## Testing

```bash
# Unit tests (node:test) — run a single file or all:
node --test js/store.test.js
node --test js/*.test.js

# Playwright E2E (needs the server running on port 9878):
npm test                    # runs tests/run.js → all Playwright suites
node tests/spinner.test.js  # single suite

# Go tests:
cd server && go test ./...

# Type / lint check:
npm run check   # node --check on all JS + eslint
```

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

- **Lucide icons only** — vendored as inline SVG sprite in `index.html <body>`. Never load external icon fonts.
- **Fonts:** Playfair Display for baby name + hero timer; Archivo for everything else.
- **Shape language:** pills for controls, large radii for cards, circles for identity/avatars.
- **Animations:** one ambient concept at a time. Fire system (`fire-a/b/c`) is the explicit exception (three coprime keyframes = one fire effect).
- **No external stylesheets** — all CSS in `styles.css` and `<style>` blocks in `index.html`.
