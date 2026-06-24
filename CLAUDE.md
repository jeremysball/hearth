# Hearth

Hearth is a free, private baby tracker — an alternative to Huckleberry.

## Principles

- Integrity and availability of user data above all else.
- Give parents the right information at the right time.
- Allow sharing between parents and caregivers in a cozy, inviting interface.
- Local first.

## Rules

- **BUMP THE FUCKING VERSION ON EVERY CHANGE.** Update both `index.html` (`<meta name="version">`) and `sw.js` (`VERSION` constant) to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M`). The two strings must match, differing only by the `hearth-` prefix in `sw.js`. This is the cache buster — without it the service worker serves stale assets and users never see your changes. First thing BEFORE you commit, every time, no exceptions.
- No framework. Vanilla JS PWA + Go backend + SQLite.
- Lucide icons only (vendored locally as an inline SVG sprite in `index.html`'s `<body>`), Playfair Display for the baby's name and the hero timer, Archivo for everything else.
- Round everything you touch: pills for controls, big radii for cards, circles for identity.
- One ambient animation at a time.
- Follow Conventional Commits for git messages.
- Keep the README current with how to install and run.
