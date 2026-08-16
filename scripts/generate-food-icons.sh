#!/usr/bin/env bash
# Generates one painterly icon per FOOD_CATALOG entry (js/foods.js) via the
# MiniMax image-generation API and writes assets/foods/<icon>.webp.
#
# Idempotent: skips any icon that already exists on disk unless --force is
# passed. Requires MINIMAX_API_KEY in the environment.
#
# Usage: scripts/generate-food-icons.sh [--force]
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY is not set" >&2
  exit 1
fi

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

mkdir -p assets/foods

# icon<TAB>label pairs straight from the catalog, so this script never
# drifts out of sync with js/foods.js.
CATALOG=$(node -e "
import('./js/foods.js').then(({ FOOD_CATALOG }) => {
  for (const f of FOOD_CATALOG) process.stdout.write(f.icon + '\t' + f.label + '\n');
});
")

while IFS=$'\t' read -r icon label; do
  [[ -z "$icon" ]] && continue
  dest="assets/foods/${icon}.webp"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    echo "skip $icon (exists)"
    continue
  fi

  echo "generating $icon ($label)..."
  prompt="flat icon illustration of ${label}, soft painterly gouache texture, warm pastel palette, subject fills almost the entire square frame, tight close-up crop, centered, simple solid pastel background, no shadow, no text, no border"

  resp=$(curl -sS -X POST https://api.minimax.io/v1/image_generation \
    -H "Authorization: Bearer $MINIMAX_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{model:"image-01",prompt:$p,aspect_ratio:"1:1",response_format:"url",n:1,prompt_optimizer:true}')")

  status=$(echo "$resp" | jq -r '.base_resp.status_code // "error"')
  if [[ "$status" != "0" ]]; then
    echo "  FAILED: $(echo "$resp" | jq -r '.base_resp.status_msg // .')" >&2
    continue
  fi

  url=$(echo "$resp" | jq -r '.data.image_urls[0]')
  tmp=$(mktemp --suffix=.jpg)
  curl -sS "$url" -o "$tmp"

  # Center-crop to 75% before downscaling: the model leaves generous
  # background margin even when asked to fill the frame, and at 20x20 icon
  # size (styles.css .icongrid-img) an uncropped source reads as a blurry
  # smudge. 128px gives headroom for high-DPI without bloating payload.
  magick "$tmp" -gravity center -crop 75x75%+0+0 +repage -resize 128x128 "$dest"
  rm -f "$tmp"
  echo "  wrote $dest"
  sleep 1
done <<< "$CATALOG"

echo "done."
