# Hearth

Hearth is a free, private baby tracker — an alternative to Huckleberry.

## Quick reference

**Read `docs/codebase-quickref.md` at the start of every session** before exploring files or touching code. It covers file map, key exports, patterns, test commands, and design constraints in one shot. Use the `/orient` skill to load it.

## Principles

- Integrity and availability of user data above all else.
- Give parents the right information at the right time.
- Allow sharing between parents and caregivers in a cozy, inviting interface.
- Local first.

## Rules

- **BUMP THE FUCKING VERSION ON EVERY CHANGE.** Run `scripts/bump-version.sh` — never hand-edit the version strings. It updates both `index.html` (`<meta name="version">`) and `sw.js` (`VERSION` constant) to the current UTC timestamp and prints both lines for verification. This is the cache buster — without it the service worker serves stale assets and users never see your changes. Run it BEFORE you commit, every time, no exceptions.
- **PUSH IMMEDIATELY AFTER EVERY COMMIT TO `main`.** Commits that sit on local `main` without being pushed cause divergence and merge conflicts the next time any worktree or session touches the branch. The required finishing sequence for any branch/worktree is: (1) `gh pr merge <N> --merge --delete-branch`, (2) `git pull --ff-only origin main` from whichever checkout has `main`, (3) `git push origin main`. If `--ff-only` fails, local `main` has unpushed commits — find them with `git log origin/main..main`, rebase onto `origin/main`, then push. Never leave `main` ahead of `origin/main`.
- No framework. Vanilla JS PWA + Go backend + SQLite.
- Lucide icons only (vendored locally as an inline SVG sprite in `index.html`'s `<body>`), Playfair Display for the baby's name and the hero timer, Archivo for everything else.
- Round everything you touch: pills for controls, big radii for cards, circles for identity.
- One ambient animation concept at a time. The fire system is the explicit exception: `fire-a`, `fire-b`, and `fire-c` are three coprime-period keyframes that together constitute a single fire ambient effect — three components is the minimum to avoid obvious periodicity in the flicker.
- Follow Conventional Commits for git messages.
- **Keep the changelog in sync with every user-facing change.** When a commit adds a feature (`feat`) or fixes a user-visible bug (`fix`), add a one-line entry to the matching dated block in `js/changelog.js` — features first, then fixes. Use plain, parent-facing language (no scopes, no shorthands). Group all changes for the same day under that day's block; create a new block at the top when the calendar day rolls over. Skip pure `test:`, `docs:`, `chore:`, `style:`, `perf:`, and `refactor:` commits that users never see. The hidden developer-mode tooling stays out of the changelog.
- Keep the README current with how to install and run.
- **Run tests before merging any PR.** Always run the unit tests (`node --test js/store.test.js`) locally, plus the Playwright suites (`tests/*.test.js`) for files the PR touches. Lean on CI for the rest: GitHub Actions runs the full Playwright suite on every PR (the `e2e` matrix leg in `.github/workflows/ci.yml`) — treat that as the gate for broad changes (e.g. `app.js`, `ui.js`, `sw.js`, `styles.css`) rather than running the full local suite (`CHROMIUM=/usr/bin/chromium npm test`) through shared-box contention. Only run the full suite locally to debug a CI failure or while iterating on test code. All suites must pass (or pre-existing failures must be confirmed unchanged) before the branch merges. Fix any new test failures before merging.
- **Never run Playwright suites in parallel.** `tests/run.js` defaults `CONCURRENCY` to 1 and CI (`.github/workflows/ci.yml`'s `e2e` leg) must not set `TEST_CONCURRENCY` above 1. Concurrent Chromium instances oversubscribe the runner's CPU and cause arbitrary timing-sensitive assertions to intermittently miss their margin — a different suite fails each run, which is worse than a slower, deterministic sequential run. If a suite feels slow, fix the suite; don't reach for concurrency.
- **Regenerate PNG icons after any change to `icons/hearth-icon.svg`.** Run: `rsvg-convert -w 192 -h 192 icons/hearth-icon.svg -o icons/icon-192.png && rsvg-convert -w 512 -h 512 icons/hearth-icon.svg -o icons/icon-512.png` for the standard icons. For the maskable icon, build a wrapper SVG with `#fbf3f0` background and the icon scaled to 358×358 centered on a 512×512 canvas (77px padding each side), then rasterize to `icons/icon-maskable-512.png`.

## Shell-out to opencode for a second opinion

When the user says **"run with gpt 5.5"** or **"run with glm 5.2"**, shell out to the `opencode` CLI for a second opinion. Always prefer the `opencode-go/` provider; fall back to another provider only when the model isn't published under `opencode-go/`.

- **"run with gpt 5.5"** → `opencode run -m openai/gpt-5.5 --dangerously-skip-permissions "<message>"` (gpt-5.5 is not available under `opencode-go/`, so `openai/` is the fallback).
- **"run with glm 5.2"** → `opencode run -m opencode-go/glm-5.2 --dangerously-skip-permissions "<message>"`.

Run from the workspace root (`/workspace/hearth`). Quote the `<message>` and keep it on one line. Pipe through `tail -200` if the output is long. Default timeout 300000ms.
