#!/usr/bin/env bash
# Copies canonical, already-committed binary assets into site/ so the
# GitHub Pages page can reference them without a second copy living in git.
# Run before previewing site/index.html locally and before the Pages
# deploy workflow uploads the site/ artifact.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p site/screenshots
cp icons/icon-512.png site/icon.png
cp screenshots/readme-hero-light.png site/screenshots/readme-hero-light.png
cp screenshots/readme-hero-dark.png site/screenshots/readme-hero-dark.png
echo "Staged icon.png and screenshots/ into site/"
