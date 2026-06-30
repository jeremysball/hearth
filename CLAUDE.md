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
- Keep the README current with how to install and run.
- **Run tests before merging any PR.** Always run the unit tests (`node --test js/store.test.js`) and the Playwright suites for files the PR touches. If the PR only touches a subset of JS/view files, run only their corresponding `tests/*.test.js` suites rather than the full `npm test`. Run the full suite (`CHROMIUM=/usr/bin/chromium npm test`) only when changes are broad (e.g. `app.js`, `ui.js`, `sw.js`, `styles.css`). All suites must pass (or pre-existing failures must be confirmed unchanged) before the branch merges. Fix any new test failures before merging. Do not install Playwright in CI — run it locally in the session.
- **Regenerate PNG icons after any change to `icons/hearth-icon.svg`.** Run: `rsvg-convert -w 192 -h 192 icons/hearth-icon.svg -o icons/icon-192.png && rsvg-convert -w 512 -h 512 icons/hearth-icon.svg -o icons/icon-512.png` for the standard icons. For the maskable icon, build a wrapper SVG with `#fbf3f0` background and the icon scaled to 358×358 centered on a 512×512 canvas (77px padding each side), then rasterize to `icons/icon-maskable-512.png`.
