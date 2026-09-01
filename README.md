<p align="center">
  <img src="public/icons/icon-512.png" width="128" height="128" alt="Hearth" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/go-1.26-00ADD8.svg" alt="Go 1.26" />
  <img src="https://img.shields.io/badge/PWA-ready-5A0FC8.svg" alt="PWA" />
  <img src="https://img.shields.io/badge/self--hosted-yes-success.svg" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/data-sovereign-critical.svg" alt="Data sovereignty" />
</p>

# Hearth

A free, private baby tracker. No ads, no lock-in, no forced account.

I built Hearth for my own family. It tracks sleep, feeds, diapers, medicine, play, and bath time, and it keeps every entry on your device. Install it as a PWA and it works offline, then syncs when your family is back online.

**[hearth.jeremyball.me →](https://hearth.jeremyball.me/)**

## Screenshots

| | Light | Dark |
| --- | --- | --- |
| Hero card | ![Hero card, light mode](screenshots/readme-hero-light.png) | ![Hero card, dark mode](screenshots/readme-hero-dark.png) |
| Logging a bottle | ![Bottle logging modal, light mode](screenshots/readme-logging-light.png) | ![Bottle logging modal, dark mode](screenshots/readme-logging-dark.png) |

## What it tracks

Hearth covers the day without asking you to learn a new system. Every entry lives on a shared timeline and stays keyed to one family, one baby, and any number of caregivers.

- **Hero card** shows how long your baby has been awake and predicts the next nap window from age and recent patterns
- **Sleep** records start, end, and quality
- **Nursing** records side, duration, and time
- **Bottles** record contents and volume
- **Diapers** record wet, dirty, or mixed
- **Medicine** lets you define custom medicines, log doses, and get interval reminders
- **Play** tracks tummy time and floor play as awake time
- **Bath** is one tap when it is done
- **Pumping** records side, volume, and time
- **SweetSpot** blends your baby's age-based window with their own recent naps to suggest when the next nap will land, not a fixed schedule
- **Sharing** lets you invite caregivers and log together in real time

## Install and Run

Hearth runs in two ways. Most families run the Docker stack on a home server. Developers and single-machine users can run the Go binary directly. Both paths need the same secrets.

### Docker and Tailscale, the recommended path

This is the setup I use at home. `docker-compose.yml` runs three containers. Tailscale joins your tailnet as `hearth`, the app shares its network namespace, and Watchtower polls GHCR every 60 seconds and recreates the app container when a new `:latest` image appears. Only devices on your tailnet can reach the app. Tailscale handles TLS.

```bash
git clone https://github.com/jeremysball/hearth.git
cd hearth

# Create a Tailscale auth key at https://login.tailscale.com/admin/settings/keys
cp .env.example .env
# Open .env and set TS_AUTHKEY, PEPPER, and the three VAPID values (see below)

sudo docker compose pull
sudo docker compose up -d
```

The app comes up at `https://hearth.<your-tailnet>.ts.net:8443`. Every merge to `main` builds a fresh image in `.github/workflows/build.yml` and the host picks it up within about a minute. The app is unreachable for about 2 to 5 seconds while Watchtower recreates the container.

To roll back, pin the `app` image in `docker-compose.yml` to a specific `:sha-<hash>` tag, find the hash in [GHCR package versions](https://github.com/jeremysball/hearth/pkgs/container/hearth), then run `sudo docker compose up -d`. Watchtower ignores any tag that is not `:latest`.

Why this instead of `build: .` on the host. Building on the host needs the full Go toolchain on that machine, a checked-out copy of the source, and a manual SSH and rebuild for each update. The GHCR and Watchtower pattern moves the build to CI. CI builds once in a clean environment on every merge to `main` and publishes the finished image. The host only pulls. That keeps deploys to a single step, merge to `main`, and it makes rollback trivial because the old image already exists in GHCR.

### Without Docker

You need Go 1.26.4, the version pinned in `go.mod` with `toolchain go1.26.4`, and Node 22 or newer, as declared in `package.json`. Vite bundles the frontend into `dist`, then Go embeds it at build time so the binary is self contained.

```bash
# one time
npm install

# rebuild the frontend and embed it into Go
npm run build            # vite build + scripts/patch-sw.mjs
go build -o hearth-server ./cmd/hearth
./hearth-server
```

The server uses `hearth.db` in the current working directory unless you set `DB_PATH` to an absolute path. Pick a stable directory before you create data.

Check it with `curl -fsS http://127.0.0.1:8443/` once you have set `PEPPER` and the VAPID keys. Without those the binary exits before it binds, which is intentional.

### Token pepper, required

Every deploy needs `PEPPER`. Hearth uses it to HMAC-SHA256 hash session cookies, invite links, launch tokens, and pending auth tokens before they touch SQLite. Without it a database backup would expose raw bearer tokens. Set it as a comma separated list with the current pepper first and older peppers after, each at least 32 bytes. The server refuses to start if it is empty.

```bash
openssl rand -hex 32   # 64 hex characters, comfortably over the 32 byte minimum
```

Set `PEPPER` in your secrets manager or `.env` before you pull a new image. If you upgrade to a version that requires `PEPPER` and you have not set it, the server will fail to start.

Rotation is simple. Prepend the new pepper, keep the old one as a fallback, and deploy. Leave both in place until no pre-rotation session remains. Session cookies last up to ten years, so this is a judgment call, weeks is reasonable for a small family. Then remove the old pepper.

Rollback after the pepper migration needs a backup. Migration `0011` renames four token columns to `token_hash` and rehashes any plaintext values in the same transaction. An older binary still queries `WHERE token = ?` and will break against the new column. Before each deploy, take a SQLite backup:

```bash
sqlite3 hearth.db ".backup hearth.pre-migration.db"
```

To roll back, stop the new binary, restore the backup over `hearth.db`, and start the previous binary. There is no in place rollback path.

### VAPID keys, required

Web push needs a VAPID keypair. The server also refuses to start without it. Generate one locally, no external service needed:

```bash
go run ./cmd/vapidgen
```

The command prints `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Put both in `.env` along with `VAPID_SUBJECT`, which should be a real `mailto:` address or URL you control. Push services will contact that subject if your server misbehaves.

### systemd

If you run the binary outside Docker, the included unit file shows the pattern:

```bash
sudo useradd --system --home-dir /opt/hearth --shell /usr/sbin/nologin hearth 2>/dev/null
sudo mkdir -p /opt/hearth
sudo cp hearth-server /usr/local/bin/
sudo cp .env /opt/hearth/.env
sudo chown -R hearth:hearth /opt/hearth
sudo cp systemd/hearth.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hearth
```

`hearth.service` runs as the `hearth` user with `WorkingDirectory=/opt/hearth`, so a relative `DB_PATH` of `hearth.db` resolves to `/opt/hearth/hearth.db`. Use an absolute `DB_PATH` if you prefer a different location.

## Configuration

All settings come from environment variables or a `.env` file in the working directory. Docker reads the same file for both the app and the Tailscale sidecar.

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address. `0.0.0.0` binds every interface, so a host with both a tailnet and a LAN will be reachable from the LAN as well. Set this to your Tailscale IP, find it with `tailscale ip -4`, to limit access to the tailnet. |
| `PORT` | `8443` | Listen port. |
| `CERT_FILE` | *(empty)* | TLS certificate path. |
| `KEY_FILE` | *(empty)* | TLS private key path. Set both `CERT_FILE` and `KEY_FILE` to enable TLS. Leave them empty for plain HTTP, the Docker setup terminates TLS at Tailscale. |
| `DB_PATH` | `hearth.db` | SQLite path. Relative to the working directory. |
| `STATIC_DIR` | *(empty)* | Empty serves the frontend embedded in the binary. Set to `.` to serve files live from disk during development so edits appear on refresh without rebuilding Go. Never set this in a Docker `.env`, the image ships with no on disk frontend. |
| `DEV_MODE` | `false` | Never enable in production. Skips the ten tap unlock and auto enables developer mode on every device. Also adds extra buttons to onboarding, described below. |
| `GEOIP_ENABLED` | `false` | Set to `true` to enrich request logs with a local MaxMind GeoLite2 City database. |
| `GEOIP_DB_PATH` | *(empty)* | Path to `GeoLite2-City.mmdb`. Required when GeoIP is enabled. |
| `MAXMIND_LICENSE_KEY` | *(empty)* | If set and `GEOIP_DB_PATH` is missing, Hearth downloads and extracts GeoLite2 City on startup. |

Other variables you will set in `.env` include `PEPPER`, the three `VAPID_*` keys, Tailscale `TS_AUTHKEY`, and optional OAuth credentials `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, and `APPLE_KEY_ID`. See `.env.example` for the full list with comments.

### Developer mode

Hearth hides its developer tools behind a deliberate gesture. Tap the version stamp at the bottom of the Profile tab ten times, each tap within two seconds of the last, and the hidden Test push in 15s button appears. The timing prevents an accidental tap from enabling it on a real device.

For a throwaway dev or test server, set `DEV_MODE=true` instead. Every device that boots against that server gets developer mode automatically. If the instance has no family yet, onboarding shows Skip with demo data, which fills in placeholder values and calls the normal onboarding finish path. If the instance already has a family, for example a dev copy of real data, the This Hearth already has a family screen shows Join as dev caregiver. That calls `POST /api/dev/join` in `server/dev.go`, which is gated on `cfg.DevMode`, and creates a caregiver and session with no invite token. Never set `DEV_MODE=true` on a server that real caregivers use.

### Recovering a locked-out caregiver

Normally you invite from inside the app, under Profile and Invite. If someone was removed from a family and never linked an OAuth provider, they have no session to invite from. With shell access to the server you can mint an invite directly:

```bash
hearth invite list             # family_id, baby name, active caregiver count, entry count
hearth invite create <family_id>
```

`hearth invite create` prints a one time `/join/<token>` link that expires in 48 hours. Anyone who opens it joins that family as a new caregiver. The command uses the same `DB_PATH` and `PUBLIC_BASE_URL` as the server, so run it on the same host and config without starting the HTTP listener.

## Architecture

Hearth is a vanilla JS PWA, a Go backend, and SQLite. No frontend framework. The frontend lives in `js/`, the backend in `server/`, and the two meet at a Vite build step.

```
hearth/
├── cmd/
│   ├── hearth/        # Server entrypoint, thin main that imports server/
│   └── vapidgen/      # One off VAPID keypair generator
├── server/            # Go package: API, auth, SQLite, SSE sync
├── js/                # Frontend source, ES modules, no framework
├── public/            # Vite publicDir: icons/, assets/, manifest.webmanifest (copied verbatim)
├── index.html         # Vite entry, links ./styles.css and ./js/app.js
├── sw.js              # Hand written service worker, patched after build
├── styles.css         # Single stylesheet, hashed by Vite
├── vite.config.js     # root '.', publicDir 'public', outDir 'dist', assetsDir 'static'
├── scripts/
│   ├── bump-version.sh    # Bumps VERSION in sw.js and <meta name="version"> in index.html
│   └── patch-sw.mjs       # Rewrites sw.js SHELL list from dist/.vite/manifest.json
├── dist/              # Vite output, gitignored except .gitkeep so go build works on fresh checkout
├── assets.go          # //go:embed all:dist then fs.Sub to expose StaticFS
├── Dockerfile         # Multi stage: npm build then go build
└── docker-compose.yml # App plus Tailscale sidecar and Watchtower
```

One family is one baby, any number of caregivers, and shared entries and settings, all keyed by `family_id`. The Go server owns the API, family-scoped isolation, and real time sync over Server Sent Events. The frontend keeps state in `localStorage` through `store.js` and syncs to the server when online. Views are functions that return HTML strings injected into `#view`, routed by `router.go` and `router.refresh`. User events flow through a single delegated click handler dispatched on `data-action="verb:noun"`. Bottom sheets use `sheet.open` from `ui.js`.

Vite emits content-hashed JS and CSS at `dist/static/<chunk>-<hash>.{js,css}` and a manifest at `dist/.vite/manifest.json`. `scripts/patch-sw.mjs` rewrites the hand written `sw.js` SHELL list to point at those hashed URLs. At runtime the Go server puts the whole `dist` tree into the binary via `assets.go`, then serves `STATIC_DIR` or the embedded tree. For URLs under `/static/*` it sends `Cache-Control: public, max-age=31536000, immutable`. Unhashed paths such as `/assets/*`, `/icons/*`, `/manifest.webmanifest`, `/sw.js`, and `index.html` keep a no-store or heuristic policy so updates propagate immediately. See `server/router.go` `cacheControl` for the exact rules. The version stamp in `index.html` and `VERSION` in `sw.js` must match, bump them with `scripts/bump-version.sh` before any frontend change.

Tailscale is the auth layer in the Docker setup. There is no login page and no passwords. Anyone on your tailnet is trusted. If you expose Hearth to the public internet, for example to enable Google OAuth, keep `PEPPER` strong. Every session cookie, invite link, and launch token is a bearer credential. The four token tables store only the HMAC-SHA256 hash of the token, keyed by your pepper, so a leaked database backup does not expose raw tokens. See `server/tokens.go`.

## Development

Two processes run side by side. The Go backend defaults to 8443 and the Vite dev server to 5173 with hot module replacement. Vite serves the bundled frontend at `http://localhost:5173/` and proxies API and shell routes to Go.

```bash
# terminal 1: Go, STATIC_DIR=. so sw.js edits appear on reload
STATIC_DIR=. go run ./cmd/hearth

# terminal 2: Vite, edit js/ and reload
npm run dev
# talk to a different Go port with HMR_BACKEND=http://localhost:9000 npm run dev
```

To exercise the production bundle, build once and drop `STATIC_DIR`:

```bash
npm run build
go run ./cmd/hearth
```

`STATIC_DIR=.` serves files live from the source tree, index.html, sw.js, and everything under `public/`. That still works for files Vite does not transform, but it does not reflect the hashed bundle. If you want to see what users will actually load, run `npm run build`.

### Server logs

The server logs through Go's standard logger. On startup it prints the database path, static mode, optional GeoIP path, and listen address. Every API request logs method, status, duration, path, client IP, remote IP, host, proxy headers, user agent, caregiver ID, family ID, and any GeoIP fields, ordered for scanning. Static file errors at 4xx and 5xx are logged. Successful asset fetches are silent.

Auth events log as `auth event=...` with caregiver ID, family ID, and origin IP. They cover signup, invite join, launch token login, OAuth link, restore, and signup, plus conflict resolution and signout. Logs never include session tokens.

GeoIP is off by default. If `GEOIP_ENABLED=true` and `GEOIP_DB_PATH` points to a missing file, Hearth will try to download GeoLite2 City when `MAXMIND_LICENSE_KEY` is set. Without a key it stops and tells you to download the database from MaxMind or provide the key. Proxy country and city headers, like Cloudflare or Vercel headers, are logged when present even without the local database. Color is added only when the log stream is an interactive terminal. Files and systemd output stay plain.

### Client debug logs

The browser is quiet by default. To trace sync and the outbox in DevTools:

```js
// persists across reloads until you clear it
localStorage.setItem('hearth.debug', '1')
```

Or append `?debug` to the URL for a single session. Disable with:

```js
localStorage.removeItem('hearth.debug')
```

Output is namespaced and color coded: info in green, warn in amber, error in red, event in blue.

## Testing

Browser tests in `tests/` spin up their own server on plain HTTP at `127.0.0.1:18787` with no TLS and no Tailscale, so they run in CI without extra setup.

```bash
npm install
npx playwright install chromium
npm test
```

`tests/run.js` builds the Go binary if needed, starts the server, drives Chromium with Playwright, then tears down. Each suite prints `N pass, N fail` and exits non zero on failure. You can run subsets while iterating:

```bash
# all unit tests, no lint, Go, or E2E
npm run test:unit
node --test js/store.test.js   # single file

# only Playwright
npm run test:e2e
node tests/spinner.test.js     # single suite

# Go tests
go test ./server

# lint and type check
npm run check     # node --check on all JS files plus eslint
```

CI runs the same four legs, lint, unit, Go, and E2E, as a matrix in `.github/workflows/ci.yml`. Run `npm test` locally and let CI gate the full suite rather than running every Playwright suite in parallel on a busy machine.

## License

MIT. See [LICENSE](LICENSE).
