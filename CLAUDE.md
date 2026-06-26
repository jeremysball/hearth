# Hearth

Hearth is a free, private baby tracker — an alternative to Huckleberry.

## Principles

- Integrity and availability of user data above all else.
- Give parents the right information at the right time.
- Allow sharing between parents and caregivers in a cozy, inviting interface.
- Local first.

## Rules

- **BUMP THE FUCKING VERSION ON EVERY CHANGE.** Update both `index.html` (`<meta name="version">`) and `sw.js` (`VERSION` constant) to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%MZ`). The two strings must match, differing only by the `hearth-` prefix in `sw.js`. Append `Z` so browsers parse the string as UTC. This is the cache buster — without it the service worker serves stale assets and users never see your changes. First thing BEFORE you commit, every time, no exceptions.
- **PUSH IMMEDIATELY AFTER EVERY COMMIT TO `main`.** Commits that sit on local `main` without being pushed cause divergence and merge conflicts the next time any worktree or session touches the branch. The required finishing sequence for any branch/worktree is: (1) `gh pr merge <N> --merge --delete-branch`, (2) `git pull --ff-only origin main` from whichever checkout has `main`, (3) `git push origin main`. If `--ff-only` fails, local `main` has unpushed commits — find them with `git log origin/main..main`, rebase onto `origin/main`, then push. Never leave `main` ahead of `origin/main`.
- No framework. Vanilla JS PWA + Go backend + SQLite.
- Lucide icons only (vendored locally as an inline SVG sprite in `index.html`'s `<body>`), Playfair Display for the baby's name and the hero timer, Archivo for everything else.
- Round everything you touch: pills for controls, big radii for cards, circles for identity.
- One ambient animation at a time.
- Follow Conventional Commits for git messages.
- Keep the README current with how to install and run.
- **Regenerate PNG icons after any change to `icons/hearth-icon.svg`.** Run: `rsvg-convert -w 192 -h 192 icons/hearth-icon.svg -o icons/icon-192.png && rsvg-convert -w 512 -h 512 icons/hearth-icon.svg -o icons/icon-512.png` for the standard icons. For the maskable icon, build a wrapper SVG with `#fbf3f0` background and the icon scaled to 358×358 centered on a 512×512 canvas (77px padding each side), then rasterize to `icons/icon-maskable-512.png`.
