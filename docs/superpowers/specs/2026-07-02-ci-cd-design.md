# CI/CD for Hearth

**Date:** 2026-07-02
**Status:** Approved → ready for implementation plan

## Goal

Put a real CI/CD loop around Hearth: gate merges on automated checks, publish a
Docker image to GHCR on every merge to `main`, and roll the host to the new
image automatically via Watchtower. Fold in a unified test runner so "run the
tests" is one command, not three.

## Non-goals

- Blue-green or health-gated deploys. Watchtower's recreate is a 2–5s blip;
  acceptable for a single-family tracker.
- Inline PR annotations (JUnit reporters per suite). Deferred — check-status
  panel is enough for now.
- Vite/webpack. The Go binary embeds `js/` at build time; a JS bundler would
  break the embed-and-serve model and the `STATIC_DIR` live-edit loop. Not
  adopted.

## Architecture

Two sides:

**CI side (GitHub Actions)** — On every PR and push to `main`, run four checks
in parallel via a matrix: lint, unit tests, Go tests, Playwright E2E. On push
to `main`, after the CI workflow succeeds on that commit, a second workflow
builds the Docker image (the existing multi-stage `Dockerfile`) and pushes it
to `ghcr.io/jeremysball/hearth` tagged `:latest` and `:sha-<short>`.

**Deploy side (host)** — Watchtower runs as a sidecar in the existing
`docker-compose.yml`. It polls GHCR for a new `:latest` digest every 60s and,
on change, re-pulls and recreates the `app` container. The hearth image flips
from `build: .` to `image: ghcr.io/jeremysball/hearth:latest`, so the host no
longer builds from source.

Rollback: change the `app` image tag to a pinned `:sha-<hash>` in
`docker-compose.yml` and `docker compose up -d`. Watchtower ignores pinned
non-`:latest` tags.

The GHCR image is **public** (the source is already public; the image leaks
nothing new). Watchtower pulls anonymously — zero secrets on the host.

## Component 1 — CI workflow (`.github/workflows/ci.yml`)

Triggers: `pull_request` against `main`, `push` to `main`.

Runner: `ubuntu-latest`. One job `check` with a matrix of four legs running in
parallel. Set `strategy.fail-fast: false` so a failing leg doesn't cancel the
others — you see every failure in one pass. Each leg's own internal failures
still exit non-zero.

| Leg      | Command                                                        | Setup                                              |
|----------|----------------------------------------------------------------|----------------------------------------------------|
| `lint`   | `npm ci && npm run check`                                      | `setup-node@22.x`, `cache: npm`                    |
| `unit`   | `npm ci && node --test js/*.test.js`                           | `setup-node@22.x`, `cache: npm`                    |
| `go`     | `go test ./server`                                             | `setup-go` with `go-version-file: go.mod`          |
| `e2e`    | `npm ci && npx playwright install chromium --with-deps && npm run test:e2e` | `setup-node@22.x`, `cache: npm`, `cache` on `~/.cache/ms-playwright`, `setup-go` with `go-version-file: go.mod` (tests/run.js builds the binary) |

Top-level `permissions: { contents: read }`.

The `e2e` leg sets `TEST_CONCURRENCY=4` so the ~20 suites run in parallel
(~1–2 min) instead of serial.

No secrets needed. The default `GITHUB_TOKEN` is read-only here.

## Component 2 — Build/publish workflow (`.github/workflows/build.yml`)

Trigger: `workflow_run` on the `ci.yml` workflow's `completed` event, gated on
`conclusion == success` and `github.event.workflow_run.head_branch == 'main'`.
This ensures the image only builds when CI passed on that same `main` commit —
a plain `push: branches: [main]` trigger would race the `ci.yml` run.

Steps:
1. `actions/checkout@v4` with `fetch-depth: 1`, `ref: ${{ github.event.workflow_run.head_sha }}` (check out the exact commit CI passed on).
2. `docker/setup-buildx-action`.
3. `docker/login-action` to `ghcr.io` with `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`.
4. `docker/build-push-action`:
   - `context: .`
   - `file: ./Dockerfile` (unchanged)
   - `push: true`
   - `tags`: `ghcr.io/jeremysball/hearth:latest`, `ghcr.io/jeremysball/hearth:sha-${{ github.event.workflow_run.head_sha }}`
   - `cache-from: type=gha`
   - `cache-to: type=gha,mode=max`

Top-level `permissions: { contents: read, packages: write }`.

## Component 3 — Watchtower on the host (`docker-compose.yml`)

Changes:

- `app` service: drop `build: .`; set `image: ghcr.io/jeremysball/hearth:latest`; add `pull_policy: always`; add label `watchtower.scope=hearth` so only Watchtower instances with matching scope touch it.
- New `watchtower` service on the **default bridge network** (it only needs to reach the public GHCR and the Docker socket — no need to share Tailscale's namespace):
  - `image: containrrr/watchtower:latest`
  - `volumes`: `/var/run/docker.sock:/var/run/docker.sock`
  - `environment`:
    - `WATCHTOWER_CLEANUP=true` (remove old images after update)
    - `WATCHTOWER_POLL_INTERVAL=60` (check every 60s)
    - `WATCHTOWER_INCLUDE_RESTARTING=true`
    - `WATCHTOWER_SCOPE=hearth` (only watch containers with matching `watchtower.scope` label — so it never recreates the `tailscale` container)
  - `restart: unless-stopped`

No `~/.docker/config.json` mount — image is public, anonymous pull works.

Operational caveat documented in README: with `WATCHTOWER_POLL_INTERVAL=60`,
every merge rolls the host within a minute. During the roll the app is briefly
down (~2–5s for the container recreate).

## Component 4 — Unified test runner (`tests/run.js`)

Pain: three commands (`node --test js/*.test.js`, `go test ./server`, `npm test`
for E2E). Fix: extend `tests/run.js` to orchestrate all four legs (lint, unit,
go, e2e) under one `npm test`.

Flow:
1. **Lint** — spawn `npm run check`. Fail-fast: broken syntax wastes the other legs.
2. **Unit** — spawn `node --test js/*.test.js` from repo root. Buffer output, keep going on failure.
3. **Go** — spawn `go test ./server` from `server/`. Buffer, keep going.
4. **E2E** — existing logic: build Go binary, run Playwright suites in parallel, collect `N pass, N fail`.
5. **Summary** — print a one-line-per-leg report: `lint ✓ | unit 49 pass | go 12 pass | e2e 20 pass 0 fail`. Exit non-zero if any leg failed.

### `package.json` scripts

```json
"test": "node tests/run.js",
"test:e2e": "node tests/run.js --e2e-only",
"test:unit": "node --test js/*.test.js"
```

Semantics shift: `npm test` today = E2E only; after this, `npm test` =
everything. The CI workflow's `e2e` matrix leg calls `npm run test:e2e` so it
doesn't re-run lint/unit/go (the other legs already cover those).

### Standalone commands still work

An agent or human can still run a single suite directly:

```bash
node --test js/store.test.js          # one unit suite
go test ./server -run TestSync        # one Go test
node tests/spinner.test.js            # one Playwright suite
```

These paths stay documented in `docs/codebase-quickref.md` and `README.md` so
an agent reads them first and doesn't have to re-derive.

## Component 5 — Branch protection (via `gh`)

After the workflows land, set `main` branch protection via the `gh` CLI so the
four `check / *` statuses are required before a PR can merge:

```bash
gh api -X PUT repos/jeremysball/hearth/branches/main/protection \
  -f required_status_checks[0]context="check / lint" \
  -f required_status_checks[1]context="check / unit" \
  -f required_status_checks[2]context="check / go" \
  -f required_status_checks[3]context="check / e2e" \
  -F required_status_checks[strict=true \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=
```

(Exact field shape verified at implementation time against the current GitHub
API — `gh api` for branch protection is finicky; `gh ruleset create` is the
newer alternative. Implementation plan picks whichever works.)

## CI results in the PR

Layer 1 only — check-status panel. Each matrix leg appears as its own row
(`check / lint`, `check / unit`, `check / go`, `check / e2e`) with pass/fail
and a link to logs. Branch protection makes all four required. This is free
with any `pull_request` workflow.

Layer 2 — inline line-level annotations from JUnit reports — deferred. Wiring
JUnit out of `node --test` + Go + Playwright needs a reporter shim each; not
worth it until the check-status panel proves insufficient.

## CLAUDE.md rule update

The current rule "Do not install Playwright in CI — run it locally in the
session" now contradicts the design. Update to:

> Run Playwright in CI on every PR (the `e2e` matrix leg). Run it locally in
> the session before merging to debug failures or when iterating on test code.

## Files touched

| File                          | Change                                                  |
|-------------------------------|---------------------------------------------------------|
| `.github/workflows/ci.yml`    | New — 4-leg matrix CI workflow                          |
| `.github/workflows/build.yml` | New — image build/publish on CI success                 |
| `tests/run.js`                | Extend — orchestrate lint+unit+go+e2e, `--e2e-only` flag |
| `package.json`                | Add `test:e2e`, `test:unit`; `test` already `run.js`     |
| `docker-compose.yml`          | `app` → `image:`; add `watchtower` service              |
| `CLAUDE.md`                   | Update the Playwright-in-CI rule                        |
| `README.md`                   | Document the unified test command + auto-deploy caveat  |
| `docs/codebase-quickref.md`   | Update the Testing section for the new scripts          |

## Verification

Implementation plan will verify by:

1. `node tests/run.js` locally — all four legs pass.
2. `npm run test:e2e` — E2E-only path works.
3. Standalone commands (`node --test js/store.test.js`, `go test ./server`,
   `node tests/spinner.test.js`) still pass.
4. `docker compose -f docker-compose.yml config` — compose file validates.
5. Push the branch, open a PR, confirm all four check rows appear and go green.
6. Merge to `main`, confirm `build.yml` triggers on `ci.yml` success and the
   image appears in GHCR with both tags.
7. On the host, `docker compose pull && docker compose up -d` once to switch to
   the image; thereafter Watchtower rolls automatically.
