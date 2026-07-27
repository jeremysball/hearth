#!/usr/bin/env bash
# Copies canonical, already-committed binary assets into site/ so the
# GitHub Pages page can reference them without a second copy living in git.
# Run before previewing site/index.html locally and before the Pages
# deploy workflow uploads the site/ artifact.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p site/screenshots site/videos
cp icons/icon-512.png site/icon.png
cp screenshots/readme-hero-light.png site/screenshots/readme-hero-light.png
cp screenshots/readme-hero-dark.png site/screenshots/readme-hero-dark.png
cp videos/showcase-day.webm site/videos/showcase-day.webm
cp videos/showcase-day.mp4 site/videos/showcase-day.mp4
cp videos/showcase-night.webm site/videos/showcase-night.webm
cp videos/showcase-night.mp4 site/videos/showcase-night.mp4
echo "Staged icon.png, screenshots/, and videos/ into site/"
