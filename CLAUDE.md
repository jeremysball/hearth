# Hearth

Hearth is a free, private baby tracker — an alternative to Huckleberry.

## Principles

- Integrity and availability of user data above all else.
- Give parents the right information at the right time.
- Allow sharing between parents and caregivers in a cozy, inviting interface.
- Local first.

## Rules

- **Bump the version on every change.** Update both `index.html` (`<meta name="version">`) and `sw.js` (`VERSION` constant) to the current UTC timestamp (`date -u +%Y-%m-%dT%H:%M`). The two strings must match, differing only by the `hearth-` prefix in `sw.js`.
- No framework. Vanilla JS PWA + Go backend + SQLite.
- Phosphor icons only, Quicksand for display type, Nunito for body.
- Round everything you touch: pills for controls, big radii for cards, circles for identity.
- One ambient animation at a time.
- Follow Conventional Commits for git messages.
- Keep the README current with how to install and run.
