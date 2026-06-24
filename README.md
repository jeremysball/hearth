<p align="center">
  <img src="icons/icon-512.png" width="128" height="128" alt="Hearth" />
</p>

# Hearth

A free, private baby tracker. No accounts, no ads, no cloud.

Track sleep, feeds, diapers, medicine, and pumping. Everything lives on your device. Install it as a PWA and it works offline.

## Features

- **Hero card** — awake timer with nap predictions based on age and typical wake windows
- **Sleep** — start, end, and quality
- **Nursing** — side, duration, and time
- **Bottles** — contents and amount
- **Diapers** — wet, dirty, or mixed
- **Medicine** — custom medicines with dose and interval reminders
- **Pumping** — side, amount, and time
- **SweetSpot** — predicts the next ideal nap window
- **Sharing** — invite caregivers to view and log together

## Install & Run

### With Docker (Tailscale)

Hearth uses **Tailscale** for both networking and authentication. The `docker-compose.yml` runs two containers:

- **Tailscale** — joins your tailnet and advertises the hostname `hearth`
- **App** — shares Tailscale's network namespace via `network_mode: "service:tailscale"`

Because the app sits behind Tailscale, only devices on your tailnet can reach it — no accounts, no passwords, no exposed ports. Tailscale also provides TLS certificates for the `*.ts.net` domain, so traffic stays encrypted end-to-end.

```bash
git clone https://github.com/jeremysball/hearth.git
cd hearth

# Get a Tailscale auth key from https://login.tailscale.com/admin/settings/keys
echo "TS_AUTHKEY=tskey-auth-..." > .env

# Tailscale-issued TLS certs for your hostname go in certs/
# (e.g. certs/hearth.your-tailnet.ts.net.crt, certs/hearth.your-tailnet.ts.net.key)
cp .env.example .env
# Set CERT_FILE and KEY_FILE to point at those certs

sudo docker compose up -d
```

Once running, the app is reachable at `https://hearth.<your-tailnet>.ts.net:8443` — but only from devices on your tailnet.

### Without Docker

You need **Go** (version matching the `go` directive in `server/go.mod`).

```bash
cd server
go build -o hearth-server .
cp hearth-server ./../
```

Then run it from the repo root (the server serves static files from `STATIC_DIR`, which defaults to the current directory):

```bash
cd /path/to/hearth
./hearth-server
```

The server reads an optional `.env` file for configuration. Without one, it serves on `0.0.0.0:8443` with no TLS.

### systemd (headless install)

Copy the binary, set up the env, and enable the unit:

```bash
sudo cp hearth-server /workspace/hearth/
sudo cp hearth.service /etc/systemd/system/
sudo systemctl enable --now hearth
```

## Configuration

All server settings come from environment variables (or a `.env` file in the working directory):

| Variable      | Default    | Description                     |
| ------------- | ---------- | ------------------------------- |
| `HOST`        | `0.0.0.0`  | Listen address                  |
| `PORT`        | `8443`     | Listen port                     |
| `CERT_FILE`   | *(empty)*  | TLS certificate path            |
| `KEY_FILE`    | *(empty)*  | TLS private key path            |
| `DB_PATH`     | `hearth.db`| SQLite database path            |
| `STATIC_DIR`  | `.`        | Directory to serve PWA files from |

When `CERT_FILE` and `KEY_FILE` are set, the server uses TLS. Leave them empty to serve plain HTTP.

## Architecture

```
hearth/
├── server/         # Go backend (API, auth, SQLite, SSE sync)
├── js/             # Vanilla JS frontend (PWA, no framework)
├── index.html      # PWA entry point
├── sw.js           # Service worker for offline support
├── styles.css      # All styles
├── icons/          # PWA icons
├── fonts/          # Self-hosted fonts
├── Dockerfile      # Multi-stage Go build + static assets
└── docker-compose.yml  # App + Tailscale sidecar
```

The Go server handles the API, multi-device sync over SSE, and family-scoped data isolation. One family has one baby, one or more caregivers, and shared settings, entries, and growth data — each scoped by `family_id`. The frontend is a vanilla JS PWA that stores data in localStorage and syncs through the server when connected. SQLite holds shared state.

Tailscale serves as the auth layer — only devices on your tailnet can reach the server. No login page, no password hashing, no session tokens. The Go server trusts that anyone who can connect is authorized.

## Development

The PWA frontend has no build step — edit the files and refresh. For the Go backend:

```bash
cd server
go run .
```

To serve the frontend with hot-reload during dev, use any static file server (e.g. `python3 -m http.server 8080`) while the Go API runs separately.
