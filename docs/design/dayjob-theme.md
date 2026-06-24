# Day Job theme — design spec

**Reference:** [dayjob.work](https://dayjob.work) — a small full-service LA/NY studio (brands, campaigns, websites; e.g. the Loisa rebrand: "rich, nostalgic, maximalist"). Their built environment (per Azure/Wallpaper*) centers **natural warmth**: cherry wood, **Heath Ceramics orange cement tiles**, **green corduroy**, "restrained compositions of solid, clean-lined forms" (Ed Ruscha flatness), "local yet global, stimulating yet relaxing." Translation for Hearth: **warm California-modern** — earthy, editorial, confident, calm.

## Palette (light) — author in `oklch()`, hexes are guides:

| Role | Hex guide | Notes |
|------|-----------|-------|
| `--page` / `--bg` | `#f3ead9` oat / `#efe3cf` | warm cream ground (replaces beige glow) |
| `--surface` | `#fbf5ea` | warm off-white cards |
| `--ink` | `#2a2520` | warm near-black |
| `--soft`/`--muted` | `#5c5345` / `#8a7d6b` | warm grays |
| `--accent` | `#c0563a` terracotta/rust | Heath-tile orange; primary actions, hero |
| `--good` (sleep) | `#7d8a5c` sage/olive | green corduroy; sleep/"good" tone |
| `--diaper` tone | `#b9863f` ochre | warm amber |
| `--med` tone | `#9a5a44` clay | |
| `--hair` | `#e3d6c0` | warm hairline |

## Dark mode

Warm espresso ground (`#221d17`), cream ink (`#efe3cf`), same accent/sage at adjusted lightness. Provide a `[data-theme="dayjob"][data-mode="dark"]` block mirroring the existing dark overrides.

## Typography (editorial treatment, same fonts)

Playfair Display stays for the baby name + hero timer but goes **larger and tighter** (display confidence); Archivo headers gain weight (700–800) and slightly looser letter-spacing for section labels (small-caps feel via `letter-spacing` + `text-transform: uppercase` on `.sec-label`/`.page-sub`). No new fonts (project rule).

## Texture

A **subtle paper grain** overlay on `--page` — a tiny inline SVG `feTurbulence` data-URI at very low opacity, applied only for `[data-theme="dayjob"]` (one ambient layer; respect `prefers-reduced-motion` by keeping it static).

## Shape/motion

Keep Hearth's rounded cards/pills/circles (project rule). Express Day Job through color, type, and grain — not corners. Reuse the single ambient animation budget.

## Constraints

Additive only; honors Lucide-only icons, Playfair+Archivo, round-everything, one-ambient-animation.

## Final oklch() values

```css
[data-theme="dayjob"] {
  --page: oklch(0.945 0.025 85);
  --bg: oklch(0.93 0.025 85);
  --surface: oklch(0.975 0.015 85);
  --ink: oklch(0.22 0.015 70);
  --soft: oklch(0.38 0.02 70);
  --muted: oklch(0.52 0.03 70);
  --accent: oklch(0.5 0.15 35);
  --accent-tint: oklch(0.9 0.05 40);
  --accent-ink: oklch(0.34 0.12 35);
  --good: oklch(0.52 0.08 135);
  --good-tint: oklch(0.92 0.04 135);
  --good-ink: oklch(0.35 0.06 135);
  --hair: oklch(0.87 0.03 80);
  --diaper: oklch(0.6 0.08 75);
  --med: oklch(0.55 0.08 45);
}

[data-theme="dayjob"][data-mode="dark"] {
  --page: oklch(0.18 0.015 70);
  --bg: oklch(0.16 0.015 70);
  --surface: oklch(0.22 0.015 70);
  --ink: oklch(0.93 0.025 85);
  --soft: oklch(0.6 0.02 70);
  --muted: oklch(0.48 0.03 70);
  --accent: oklch(0.64 0.14 35);
  --accent-tint: oklch(0.24 0.05 35);
  --accent-ink: oklch(0.9 0.06 38);
  --good: oklch(0.56 0.08 135);
  --good-tint: oklch(0.22 0.04 135);
  --good-ink: oklch(0.92 0.04 135);
  --hair: oklch(0.25 0.02 80);
  --diaper: oklch(0.55 0.08 75);
  --med: oklch(0.5 0.08 45);
}
```
