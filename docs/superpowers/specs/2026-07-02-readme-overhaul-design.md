# README overhaul

## Goal

Make the README sell Hearth to two audiences at once — people who might self-host it, and people evaluating the engineering — without sounding like marketing copy. The current README (`README.md`) already covers install, config, architecture, dev, and testing accurately; it just has no visual proof the product is real and no quick-scan credibility signals.

## Changes

1. **Badges row**, directly under the header logo: MIT license, Go version, and a couple of plain descriptive badges (`PWA`, `self-hosted`, `no cloud`). Shields.io markdown badges, no external service dependency beyond the badge images themselves.
2. **Screenshots section**, placed after the one-line hook and before "What it tracks": hero card (awake timer) and one logging modal (feed), each in light and dark mode. Captured live from a running instance via Playwright, following the existing pattern in `_screenshot.js`. Saved as PNGs under `screenshots/`.
3. **LICENSE file**: add MIT license at repo root, dated 2026, copyright holder "Jeremy Ball".
4. Everything else in the current README — What it tracks, Install & Run, Configuration, Architecture, Development, Testing — stays as-is, content-wise. Minor tightening only if reorganizing around the new sections requires it.
5. **License section** added at the bottom of the README, pointing to the LICENSE file.
6. No mention of AI/Claude Code authorship in the README body — attribution lives in commit metadata (`Co-Authored-By: Claude`), which is sufficient.

## Out of scope

- No wiki.
- No CI badge (no CI configured).
- No rewrite of existing prose sections beyond light tightening.
- No OG image regeneration (one already exists at `icons/og-image.png`; leave as-is unless it's stale).

## Assets to produce

- `LICENSE` (MIT)
- `screenshots/readme-hero-light.png`
- `screenshots/readme-hero-dark.png`
- `screenshots/readme-logging-light.png`
- `screenshots/readme-logging-dark.png`
