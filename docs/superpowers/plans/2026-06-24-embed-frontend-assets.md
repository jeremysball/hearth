# Embed Frontend Assets Implementation Plan

> **Status:** PARTIAL — Tasks 1, 3, 4, 5 landed; Task 2 (embed the static `index.html`/`js/`/`styles.css`/`icons`/`manifest`/`sw.js` via `go:embed`) never shipped. Only `schema.sql` is embedded today; the binary still requires `STATIC_DIR` to serve the frontend.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `hearth-server` binary self-contained by embedding the PWA frontend (`index.html`, `js/`, `styles.css`, `icons/`, `manifest.webmanifest`, `sw.js`) into it via `go:embed`, while keeping a `STATIC_DIR` env var as an explicit developer escape hatch that serves the same files live from disk so editing the frontend still needs no rebuild.

**Architecture:** Today `server/go.mod` makes `server/` its own Go module, which makes embedding the repo-root frontend assets impossible (`go:embed` cannot reach outside its own module). This plan first consolidates the repo onto a single root-level Go module (deleting the now-unneeded `go.work` workspace), then adds a root-level `embed.FS` next to the static files, then wires the router to pick between that embedded FS and `os.DirFS(STATIC_DIR)` based on whether `STATIC_DIR` is set. Default (`STATIC_DIR` unset) serves the embedded build; setting `STATIC_DIR=.` restores today's live-disk behavior for local dev.

**Tech Stack:** Go 1.26.4 stdlib only (`embed`, `io/fs`, `net/http`'s `http.FileServerFS`/`http.ServeFileFS`, both stdlib since Go 1.22) — no new dependencies.

## Global Constraints

- Go directive in go.mod is `go 1.26.4` — keep it as-is, don't bump or lower it.
- Every commit must update `index.html`'s `<meta name="version">` and `sw.js`'s `VERSION` constant to the same UTC timestamp first, via `date -u +%Y-%m-%dT%H:%M` (project hard rule — cache buster for the service worker). The two strings must match exactly except for the `hearth-` prefix in `sw.js`.
- Commit messages must follow Conventional Commits (`feat:`, `fix:`, `chore:`, etc.).
- No framework changes; this plan touches only Go server code, build/packaging files, and docs — not the JS app logic.
- README must stay current with install/run instructions (project rule) — Task 5 updates it.

---

### Task 1: Consolidate the Go module to the repo root

**Files:**
- Move: `server/go.mod` → `go.mod`
- Move: `server/go.sum` → `go.sum`
- Delete: `go.work`, `go.work.sum`
- Modify: `go.mod:1` (module path)

**Interfaces:**
- Consumes: nothing (pure structural move, no behavior change).
- Produces: a single Go module rooted at `/` with path `github.com/jeremysball/hearth`, covering both the new root-level package (added in Task 2) and the existing `server` package. Task 2 and Task 3 both depend on this module covering the repo root.

This module path rename is required, not cosmetic: Go's module-path-to-directory convention requires a module's import path to match its location relative to its repo's VCS root. Since the module's go.mod is moving from `server/` to the repo root, its path must drop the `/server` suffix.

- [ ] **Step 1: Move go.mod and go.sum to the repo root**

```bash
cd /workspace/hearth
git mv server/go.mod go.mod
git mv server/go.sum go.sum
```

- [ ] **Step 2: Update the module path**

In `go.mod`, change:
```
module github.com/jeremysball/hearth/server
```
to:
```
module github.com/jeremysball/hearth
```

- [ ] **Step 3: Delete the now-unnecessary workspace files**

A `go.work` workspace exists to develop multiple local modules together. After Step 1-2 there's only one module, so it's dead weight.

```bash
git rm go.work go.work.sum
```

- [ ] **Step 4: Verify nothing broke**

```bash
cd /workspace/hearth
go build -o /tmp/hearth-server-check ./server && rm /tmp/hearth-server-check
go test ./...
```
Expected: build succeeds, `ok github.com/jeremysball/hearth/server ...` (same tests as before, now under the renamed module path).

- [ ] **Step 5: Bump version and commit**

```bash
date -u +%Y-%m-%dT%H:%M
```
Update `index.html:9` and `sw.js:2` to that timestamp (see Global Constraints for the exact format).

```bash
git add go.mod go.sum index.html sw.js
git commit -m "chore: consolidate go module to repo root"
```

---

### Task 2: Embed the frontend static assets

**Files:**
- Create: `assets.go` (repo root)
- Create: `assets_test.go` (repo root)

**Interfaces:**
- Consumes: the single-module layout from Task 1.
- Produces: `hearth.StaticFS` (type `embed.FS`, package `github.com/jeremysball/hearth`) — Task 3's `server` package imports this and reads files from it (e.g. `hearth.StaticFS`, no constructor needed, it's a package-level var).

- [ ] **Step 1: Write the failing test**

Create `assets_test.go`:
```go
package hearth

import "testing"

func TestStaticFSContainsFrontendEntrypoint(t *testing.T) {
	data, err := StaticFS.ReadFile("index.html")
	if err != nil {
		t.Fatalf("reading index.html from StaticFS: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("index.html is empty")
	}

	if _, err := StaticFS.ReadFile("js/app.js"); err != nil {
		t.Fatalf("reading js/app.js from StaticFS: %v", err)
	}
	if _, err := StaticFS.ReadFile("sw.js"); err != nil {
		t.Fatalf("reading sw.js from StaticFS: %v", err)
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /workspace/hearth
go test . -run TestStaticFSContainsFrontendEntrypoint -v
```
Expected: FAIL — `undefined: StaticFS` (compile error, since `assets.go` doesn't exist yet).

- [ ] **Step 3: Write the embed file**

Create `assets.go` (the codebase already has one precedent for this exact pattern in `server/db.go`'s `//go:embed schema.sql` — same idiom, just more files):
```go
package hearth

import "embed"

//go:embed index.html js styles.css icons manifest.webmanifest sw.js
var StaticFS embed.FS
```

- [ ] **Step 4: Run the test again to confirm it passes**

```bash
go test . -run TestStaticFSContainsFrontendEntrypoint -v
```
Expected: PASS.

- [ ] **Step 5: Bump version and commit**

```bash
date -u +%Y-%m-%dT%H:%M
```
Update `index.html:9` and `sw.js:2` to that timestamp.

```bash
git add assets.go assets_test.go index.html sw.js
git commit -m "feat: embed frontend static assets into the binary"
```

---

### Task 3: Make STATIC_DIR an explicit disk-serving override

**Files:**
- Modify: `server/config.go:26` (default value)
- Modify: `server/config_test.go` (`TestLoadConfigDefaults`)
- Modify: `server/router.go` (`newRouter` signature + body)
- Modify: `server/main.go:16-20` (call site + log line)
- Create: `server/router_test.go`

**Interfaces:**
- Consumes: `hearth.StaticFS` from Task 2.
- Produces: `newRouter(db *sql.DB, hub *Hub, staticDir string) http.Handler` — the `staticDir` parameter is the new public signature later tasks (Task 4's Docker build, Task 5's docs) describe to end users as the `STATIC_DIR` env var. Empty string means "serve `hearth.StaticFS`"; any non-empty string means "serve `os.DirFS(staticDir)`".

- [ ] **Step 1: Write the failing test for the new config default**

In `server/config_test.go`, extend `TestLoadConfigDefaults` (it already unsets `STATIC_DIR` before calling `loadConfig()`, it just never asserted on it):
```go
	if cfg.DBPath != "hearth.db" {
		t.Errorf("DBPath = %q, want hearth.db", cfg.DBPath)
	}
	if cfg.StaticDir != "" {
		t.Errorf("StaticDir = %q, want empty (embedded by default)", cfg.StaticDir)
	}
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd /workspace/hearth
go test ./server/... -run TestLoadConfigDefaults -v
```
Expected: FAIL — `StaticDir = ".", want empty (embedded by default)`.

- [ ] **Step 3: Change the default**

In `server/config.go`, change:
```go
		StaticDir: getenv("STATIC_DIR", "."),
```
to:
```go
		StaticDir: getenv("STATIC_DIR", ""),
```

- [ ] **Step 4: Run it again to confirm it passes**

```bash
go test ./server/... -run TestLoadConfigDefaults -v
```
Expected: PASS.

- [ ] **Step 5: Write the failing tests for router behavior**

Create `server/router_test.go`:
```go
package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRouterServesEmbeddedIndexByDefault(t *testing.T) {
	db := newTestDB(t)
	mux := newRouter(db, newHub(), "")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/index.html", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<html") {
		t.Fatalf("expected HTML body, got: %s", rec.Body.String())
	}
}

func TestRouterServesFromDiskWhenStaticDirSet(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>disk override</html>"), 0644); err != nil {
		t.Fatal(err)
	}

	db := newTestDB(t)
	mux := newRouter(db, newHub(), dir)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/index.html", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "disk override") {
		t.Fatalf("expected disk override body, got: %s", rec.Body.String())
	}
}
```

- [ ] **Step 6: Run it to confirm it fails**

```bash
go test ./server/... -run TestRouter -v
```
Expected: FAIL — compile error, `not enough arguments in call to newRouter`.

- [ ] **Step 7: Update `newRouter` to pick embedded vs. disk**

In `server/router.go`, replace the whole file with:
```go
package main

import (
	"database/sql"
	"io/fs"
	"net/http"
	"os"

	"github.com/jeremysball/hearth"
)

func newRouter(db *sql.DB, hub *Hub, staticDir string) http.Handler {
	var staticFS fs.FS = hearth.StaticFS
	if staticDir != "" {
		staticFS = os.DirFS(staticDir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("GET /join/{token}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, staticFS, "index.html")
	})
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.HandleFunc("GET /api/caregivers", requireAuth(db, handleListCaregivers(db)))
	mux.Handle("/", http.FileServerFS(staticFS))
	return mux
}
```

- [ ] **Step 8: Update the call site and log line in `server/main.go`**

Replace:
```go
	hub := newHub()
	mux := newRouter(db, hub)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (db: %s, static: %s)", addr, cfg.DBPath, cfg.StaticDir)
```
with:
```go
	hub := newHub()
	mux := newRouter(db, hub, cfg.StaticDir)
	addr := cfg.Host + ":" + cfg.Port

	staticSrc := cfg.StaticDir
	if staticSrc == "" {
		staticSrc = "embedded"
	}
	log.Printf("Hearth server listening on %s (db: %s, static: %s)", addr, cfg.DBPath, staticSrc)
```

- [ ] **Step 9: Run the full suite to confirm everything passes**

```bash
cd /workspace/hearth
go test ./...
```
Expected: `ok github.com/jeremysball/hearth/server ...`, all tests pass including the two new ones.

- [ ] **Step 10: Manual smoke test of both modes**

```bash
go build -o /tmp/hearth-server-smoke ./server
DB_PATH=/tmp/hearth-smoke.db PORT=18799 HOST=127.0.0.1 /tmp/hearth-server-smoke &
SRV=$!
sleep 1
curl -s http://127.0.0.1:18799/index.html | head -c 200   # expect embedded index.html HTML
kill "$SRV"; wait "$SRV" 2>/dev/null; rm -f /tmp/hearth-smoke.db

DB_PATH=/tmp/hearth-smoke.db PORT=18799 HOST=127.0.0.1 STATIC_DIR=. /tmp/hearth-server-smoke &
SRV=$!
sleep 1
curl -s http://127.0.0.1:18799/index.html | head -c 200   # expect the same HTML, served from disk this time
kill "$SRV"; wait "$SRV" 2>/dev/null; rm -f /tmp/hearth-smoke.db /tmp/hearth-server-smoke
```
Expected: both curls return the same `<!DOCTYPE html>...` content — proving the embedded path and the `STATIC_DIR=.` disk path serve identical content today (and that editing a file on disk would only show up in the second mode).

- [ ] **Step 11: Bump version and commit**

```bash
date -u +%Y-%m-%dT%H:%M
```
Update `index.html:9` and `sw.js:2` to that timestamp.

```bash
git add server/config.go server/config_test.go server/router.go server/router_test.go server/main.go index.html sw.js
git commit -m "feat: serve embedded frontend by default, STATIC_DIR overrides to disk"
```

---

### Task 4: Update the Dockerfile for the embedded build

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: the consolidated root module (Task 1) and `assets.go` (Task 2) — the builder stage now needs the static files present at build time (for `go:embed` to read them), not the final stage.
- Produces: a final image containing only the `hearth-server` binary — no separate frontend files copied in.

The current Dockerfile's final stage does `COPY fonts/ ./fonts/` (line 18), but no `fonts/` directory exists anywhere in this repo — fonts are loaded from Google Fonts via a `<link>` in `index.html`, not self-hosted. That line would fail any `docker build` run today. This task removes it as a natural side effect of moving asset-copying into the builder stage (where it's no longer needed at all, since the binary carries its own assets).

- [ ] **Step 1: Rewrite the Dockerfile**

Replace the full contents of `Dockerfile` with:
```dockerfile
# syntax=docker/dockerfile:1

# Builder Go version must be >= the "go" directive in go.mod.
FROM golang:1.26.4-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY index.html manifest.webmanifest styles.css sw.js assets.go ./
COPY js/ ./js/
COPY icons/ ./icons/
COPY server/ ./server/
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/hearth-server ./server

FROM alpine:3.20
RUN addgroup -S hearth && adduser -S hearth -G hearth
WORKDIR /app
COPY --from=builder /out/hearth-server ./hearth-server
RUN mkdir -p /app/data && chown -R hearth:hearth /app
USER hearth
ENV DB_PATH=/app/data/hearth.db
EXPOSE 8443
VOLUME ["/app/data"]
ENTRYPOINT ["./hearth-server"]
```

- [ ] **Step 2: Try to validate the build**

```bash
which docker
```
If Docker is available, run `docker build -t hearth-test .` from `/workspace/hearth` and confirm it succeeds, then `docker run --rm hearth-test` should fail only on missing `TS_AUTHKEY`/certs config (not on a missing file), proving the binary starts and serves embedded assets.

If Docker is **not** available in this environment (it wasn't, as of this plan being written — confirm with the command above before assuming otherwise), skip the actual build and note in the commit message or PR description that the Dockerfile was updated but not build-tested locally; ask the user to verify with `docker compose up -d` on a machine that has Docker before relying on it for a real deploy.

- [ ] **Step 3: Bump version and commit**

```bash
date -u +%Y-%m-%dT%H:%M
```
Update `index.html:9` and `sw.js:2` to that timestamp.

```bash
git add Dockerfile index.html sw.js
git commit -m "fix: build embedded assets in docker builder stage, drop dead fonts/ copy"
```

---

### Task 5: Update docs and env files

**Files:**
- Modify: `README.md` (Configuration table, "Without Docker" section, "Development" section)
- Modify: `.env.example`
- Modify: `/workspace/hearth/.env` (not committed — gitignored)

**Interfaces:**
- Consumes: the final `STATIC_DIR` semantics from Task 3 (empty = embedded, set = disk path).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Update the Configuration table in `README.md`**

Replace:
```
| `DB_PATH`     | `hearth.db`| SQLite database path            |
| `STATIC_DIR`  | `.`        | Directory to serve PWA files from |
```
with:
```
| `DB_PATH`     | `hearth.db`| SQLite database path            |
| `STATIC_DIR`  | *(empty)*  | When empty, serves the frontend embedded in the binary. When set to a path, serves frontend files live from that directory instead — set it to `.` for local development so editing `index.html`/`js/*.js` shows up on refresh without rebuilding Go. |
```

- [ ] **Step 2: Update the "Without Docker" build instructions**

Replace:
```
You need **Go** (version matching the `go` directive in `server/go.mod`).

\`\`\`bash
cd server
go build -o hearth-server .
cp hearth-server ./../
\`\`\`

Then run it from the repo root (the server serves static files from `STATIC_DIR`, which defaults to the current directory):

\`\`\`bash
cd /path/to/hearth
./hearth-server
\`\`\`
```
with:
```
You need **Go** (version matching the `go` directive in `go.mod`).

\`\`\`bash
cd server
go build -o hearth-server .
\`\`\`

The frontend is embedded into the binary at build time, so `hearth-server` is self-contained — run it from wherever you like:

\`\`\`bash
./hearth-server
\`\`\`

(`DB_PATH` still defaults to a relative `hearth.db`, so pick a consistent working directory, or set `DB_PATH` to an absolute path.)
```

- [ ] **Step 3: Add a STATIC_DIR note to the "Development" section**

Replace:
```
The PWA frontend has no build step — edit the files and refresh. For the Go backend:

\`\`\`bash
cd server
go run .
\`\`\`
```
with:
```
The PWA frontend has no build step — edit the files and refresh, *if* the server is running with `STATIC_DIR` set (e.g. `STATIC_DIR=. go run .` from `server/`). Without it, the server serves the frontend embedded at the last Go build, so frontend-only edits won't show up until you rebuild.

\`\`\`bash
cd server
STATIC_DIR=. go run .
\`\`\`
```

- [ ] **Step 4: Update `.env.example`**

Replace:
```
PORT=8443
HOST=0.0.0.0
DB_PATH=hearth.db
STATIC_DIR=.
CERT_FILE=
KEY_FILE=
```
with:
```
PORT=8443
HOST=0.0.0.0
DB_PATH=hearth.db
# Leave STATIC_DIR empty to serve the frontend embedded in the binary.
# Set it to a path (e.g. "." when running from the repo root) to serve
# frontend files live from disk instead, for local development.
# Do NOT set this in a .env used by docker-compose — the Docker image
# ships no on-disk frontend files, so disk mode there 404s everything.
STATIC_DIR=
CERT_FILE=
KEY_FILE=
```

- [ ] **Step 5: Add STATIC_DIR to the live `.env` file**

This file is gitignored — edit it directly, no commit involved. Append a line so this machine's running instance (started via `hearth.service`, `WorkingDirectory=/workspace/hearth`) keeps serving the live, editable frontend from `/workspace/hearth` exactly as it does today:
```bash
cat >> /workspace/hearth/.env <<'EOF'
# Disk mode for local dev — do NOT copy this line into any .env consumed by
# docker-compose (env_file: .env there). The Docker image after Task 4 has
# no on-disk frontend files, so STATIC_DIR=. in that context would 404 everything.
STATIC_DIR=.
EOF
```
Verify:
```bash
cat /workspace/hearth/.env
```
Expected: now contains `PORT=8443`, `HOST=0.0.0.0`, the warning comment, `STATIC_DIR=.`, `CERT_FILE=...`, `KEY_FILE=...`.

If this host's `hearth.service` is currently running, restart it so it picks up the new `.env` line:
```bash
sudo systemctl restart hearth
```

- [ ] **Step 6: Bump version and commit**

```bash
date -u +%Y-%m-%dT%H:%M
```
Update `index.html:9` and `sw.js:2` to that timestamp.

```bash
git add README.md .env.example index.html sw.js
git commit -m "docs: document embedded-by-default frontend and STATIC_DIR dev override"
```

(`.env` itself is gitignored — it was edited in Step 5 but is never staged or committed.)

---

## Self-Review

**Spec coverage:**
- Embed frontend assets via `go:embed` → Task 2.
- Keep `STATIC_DIR` as a developer escape hatch, default to embedded → Task 3.
- Fix the pre-existing bug where `STATIC_DIR` was parsed but never actually used by the router → Task 3, Step 7-8.
- Add `STATIC_DIR` to the user's actual `.env` file → Task 5, Step 5.
- Document the new behavior in README/`.env.example` → Task 5, Steps 1-4.
- Dockerfile compatibility with the embedded build (and the discovered dead `fonts/` COPY) → Task 4.
- Version bump before every commit per project rule → every task's last step.

**Placeholder scan:** No TBDs; every step shows literal file contents/diffs and exact commands.

**Type consistency:** `newRouter(db *sql.DB, hub *Hub, staticDir string) http.Handler` is introduced in Task 3 and used identically in `main.go`'s call site and both `router_test.go` tests. `hearth.StaticFS` (type `embed.FS`) is defined in Task 2 and consumed only in Task 3's `router.go` via the `fs.FS` interface — no mismatches.
