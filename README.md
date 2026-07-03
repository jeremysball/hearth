<p align="center">
  <img src="icons/icon-512.png" width="128" height="128" alt="Hearth" />
</p>

# Hearth

A free, private baby tracker. No accounts, no ads, no cloud.

Track sleep, feeds, diapers, medicine, and pumping. Everything stays on your device: install it as a PWA and it works offline.

## What it tracks

- **Hero card**: awake timer with age-based nap window predictions
- **Sleep**: start, end, and quality
- **Nursing**: side, duration, and time
- **Bottles**: contents and volume
- **Diapers**: wet, dirty, or mixed
- **Medicine**: custom medicines, doses, and interval reminders
- **Pumping**: side, volume, and time
- **SweetSpot**: predicts the next ideal nap window
- **Sharing**: invite caregivers to log together in real time

## Install & Run

### Docker + Tailscale

Hearth uses Tailscale for networking and auth. The `docker-compose.yml` runs two containers: Tailscale joins your tailnet and advertises the hostname `hearth`, and the app shares its network namespace. Only devices on your tailnet can reach it. Tailscale handles TLS.

```bash
git clone https://github.com/jeremysball/hearth.git
cd hearth

# Tailscale auth key: https://login.tailscale.com/admin/settings/keys
cp .env.example .env
# Fill in TS_AUTHKEY, CERT_FILE, and KEY_FILE

sudo docker compose up -d
```

The app runs at `https://hearth.<your-tailnet>.ts.net:8443`.

### Without Docker

Requires Go (version in `server/go.mod`). The frontend embeds into the binary at build time, so the resulting binary is self-contained.

```bash
cd server
go build -o ../hearth-server .
cd ..
./hearth-server
```

`DB_PATH` defaults to a `hearth.db` relative to where you run the binary. Pick a stable working directory, or set `DB_PATH` to an absolute path.

### systemd

```bash
sudo cp hearth-server /usr/local/bin/
sudo cp hearth.service /etc/systemd/system/
sudo systemctl enable --now hearth
```

## Configuration

Settings come from environment variables or a `.env` file in the working directory:

| Variable              | Default     | Description |
| --------------------- | ----------- | ----------- |
| `HOST`                | `0.0.0.0`   | Listen address |
| `PORT`                | `8443`      | Listen port |
| `CERT_FILE`           | *(empty)*   | TLS certificate path |
| `KEY_FILE`            | *(empty)*   | TLS private key path |
| `DB_PATH`             | `hearth.db` | SQLite database path |
| `STATIC_DIR`          | *(empty)*   | Empty: serve the frontend embedded in the binary. Set to `.`: serve files live from disk, so edits show up on refresh without a Go rebuild. |
| `GEOIP_ENABLED`       | `false`     | Set to `true` to enrich request logs from a local MaxMind GeoLite2 City database. |
| `GEOIP_DB_PATH`       | *(empty)*   | Path to `GeoLite2-City.mmdb`. Required when GeoIP is enabled. |
| `MAXMIND_LICENSE_KEY` | *(empty)*   | Optional. If set and `GEOIP_DB_PATH` is missing, Hearth downloads and extracts GeoLite2 City on startup. |

Set both `CERT_FILE` and `KEY_FILE` to enable TLS; leave them empty for plain HTTP.

## Architecture

```
hearth/
├── server/            # Go backend: API, auth, SQLite, SSE sync
├── js/                # Vanilla JS frontend, no framework
├── index.html         # PWA shell
├── sw.js              # Service worker
├── styles.css         # All styles
├── icons/             # PWA icons
├── Dockerfile         # Multi-stage Go build
└── docker-compose.yml # App + Tailscale sidecar
```

The Go server owns the API, family-scoped data isolation, and real-time sync over SSE. One family means one baby, any number of caregivers, and shared entries and settings, all keyed by `family_id`. The frontend is a vanilla JS PWA: data lives in localStorage and syncs to the server when connected. SQLite holds the shared state.

Tailscale is the auth layer. It has no login page, no passwords, and no token hashing: anyone on your tailnet is trusted.

## Development

Run the server with `STATIC_DIR` set so frontend edits show up on refresh without rebuilding:

```bash
cd server
STATIC_DIR=. go run .
```

Without `STATIC_DIR`, the server serves the frontend baked in at the last Go build.

### Server logs

The server logs through Go's standard logger. On startup: db path, static mode, optional GeoIP database path, and address. Every API request logs structured fields ordered for scanning: method, status, duration, path, client IP, remote IP, host, proxy headers, user agent, caregiver ID, family ID, and available GeoIP fields. Static file errors (4xx/5xx) are logged; successful asset fetches are silent. Status and auth events are colorized only when the log stream is an interactive terminal; redirected files and systemd logs stay plain text.

Auth events log as `auth event=...` with caregiver ID, family ID, and origin IP. Events include signup, invite join, launch-token login, OAuth link/restore/signup, OAuth conflict resolution, and signout. Logs never include session tokens.

GeoIP is off by default. If `GEOIP_ENABLED=true` and `GEOIP_DB_PATH` points to a missing file, startup downloads GeoLite2 City when `MAXMIND_LICENSE_KEY` is set. Without a license key, startup stops with a message telling the operator to download the database from MaxMind or provide the key. Proxy-provided location headers, such as Cloudflare or Vercel country/city headers, are logged when present even without the local database.

### Client debug logs

The browser logs nothing by default. To enable sync and outbox tracing in DevTools:

```js
// persists across reloads until cleared
localStorage.setItem('hearth.debug', '1')
```

Or append `?debug` to the URL for one session. To turn it off:

```js
localStorage.removeItem('hearth.debug')
```

Output is namespaced and colour-coded: `info` (green), `warn` (amber), `error` (red), `event` (blue).

## Testing

Browser tests in `tests/` run against a self-spawned server on plain HTTP, with no TLS and no Tailscale, so they work in CI.

```bash
npm install
npx playwright install chromium
npm test
```

The runner builds the Go binary if needed, starts the server on `127.0.0.1:18787`, drives Chromium via Playwright, and tears down on exit. Each suite reports `N pass, N fail`; any failure exits non-zero.

## License

MIT — see [LICENSE](LICENSE).
