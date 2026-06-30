#!/usr/bin/env bash
# Bumps the cache-buster version in index.html and sw.js to the current UTC timestamp.
# Run before every commit that touches a cached user-facing asset.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS=$(date -u +%Y-%m-%dT%H:%MZ)

# index.html: <meta name="version" content="TIMESTAMP" />
sed -i "s|<meta name=\"version\" content=\"[^\"]*\"|<meta name=\"version\" content=\"${TS}\"|" "$ROOT/index.html"

# sw.js: const VERSION = 'hearth-TIMESTAMP';
sed -i "s|const VERSION = 'hearth-[^']*'|const VERSION = 'hearth-${TS}'|" "$ROOT/sw.js"

echo "Version bumped to $TS"
grep 'name="version"' "$ROOT/index.html"
grep "^const VERSION" "$ROOT/sw.js"
