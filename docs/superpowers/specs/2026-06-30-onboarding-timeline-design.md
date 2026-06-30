# Hearth — Onboarding Theme Alignment and Timeline Polish

**Date:** 2026-06-30
**Status:** Approved

---

## 1. Onboarding theme alignment

### Goal

The onboarding screen should feel like the app it introduces: same typographic voice, same theme palette, and the correct starting theme when re-entering onboarding after an account sign-in.

### Design

**Expand the theme picker to all four themes.** Profile already exposes girl, boy, dayjob-girl, and dayjob-boy. Onboarding only shows two. Add the dayjob row so users can start in the right aesthetic. All four swatches already have CSS (`.theme-swatch.dayjob-girl`, `.theme-swatch.dayjob-boy`). `onboardTheme` already sets `document.body.dataset.theme` directly, so the live-preview works for free.

Update the picker in `onboarding()` to a 2×2 grid (or a 4-column single row — use the 2×2 to match what Profile does):

```html
<button … data-theme="girl"><span class="theme-swatch girl"></span>Girl</button>
<button … data-theme="boy"><span class="theme-swatch boy"></span>Boy</button>
<button … data-theme="dayjob-girl"><span class="theme-swatch dayjob-girl"></span>Warm</button>
<button … data-theme="dayjob-boy"><span class="theme-swatch dayjob-boy"></span>Cool</button>
```

The `.on` class logic in `onboarding()` already reads `document.body.dataset.theme`, so it will correctly highlight whichever theme is active when re-rendering.

**Apply Playfair Display to the onboarding tagline.** `.onb-sub` currently uses Hanken Grotesk via `var(--font-sans)`. The app's first typographic impression is the baby name in Playfair; the onboarding tagline should speak the same language. Add a dedicated class `.onb-tagline` (or extend `.onb-sub`) that sets `font-family: "Playfair Display", serif`. Keep font-size at 16px, weight 400 (regular italic reads warmly here), color `var(--ink)`. Rewrite the tagline to match the concision rules: "A calm home for your baby's days." — cut "and nights", end on the strong word.

**Initialize from saved theme on re-entry.** `onboarding()` reads `document.body.dataset.theme`, which reflects whatever `applyTheme()` set at app boot. For a returning user (e.g. after joining a new family via an invite link), this is already correct. No code change needed — confirm by tracing `join.js:85` which calls `applyTheme()` before rendering.

### Touched Code

- `js/onboarding.js`: expand theme picker HTML to 4 buttons; update `.on` initial check to cover all four slugs; change tagline copy.
- `styles.css`: add `.onb-tagline` rule (`font-family: "Playfair Display", serif; font-size: 16px; font-weight: 400; font-style: italic; color: var(--ink)`); change `.onb-sub` reference in HTML.
- `index.html`, `sw.js`: bump version.

### Verification

- Onboarding renders with all 4 theme swatches. Tapping each changes the page background live.
- `dayjob-girl` and `dayjob-boy` selected states highlight correctly.
- The tagline uses Playfair Display (inspect computed `font-family`).
- Playwright test: visit onboarding, assert 4 `.theme-opt` buttons exist; click each and assert `document.body.dataset.theme` updates.

---

## 2. Timeline visual polish

### Goal

The timeline built in `feat/fixes-and-timeline` is functionally complete. This polishes the visual presentation: entry count in day headers, hidden chipbar scrollbar, row dividers, and a back button that matches the app pattern.

### Design

**Entry count in day header.** The day header (`tl-day-hd`) shows "Today" or "Mon, Jun 30". Add a muted count badge: `Today · <span class="tl-day-ct">7</span>` — same row, right-aligned via `display: flex; justify-content: space-between`. Style `.tl-day-ct` as `font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .03em`. Compute from `g.items.length` already available in `groupByDay` output.

**Hide the chipbar scrollbar.** `.tl-chipbar` uses `overflow-x: auto`. Add:

```css
.tl-chipbar::-webkit-scrollbar { display: none; }
.tl-chipbar { scrollbar-width: none; }
```

This is already the pattern used for the home cards row (check `.cards-row` for reference).

**Row dividers in day card.** `.tl-row` sits inside `.card.log`. Add a `border-bottom: 1px solid var(--hair)` on `.tl-row` and `border-bottom: none` on `.tl-row:last-child`. This gives the same visual rhythm as the reminders list items on Home.

**Back button matches app pattern.** `.tl-back` currently renders a plain circle with `var(--hair)` background. The app's sheet close buttons use a slightly different affordance. Make `.tl-back` consistent: `background: var(--accent-tint); color: var(--accent-ink)` — the same filled-tint treatment used for the photo edit overlays and some icon buttons. This ties the back affordance to the app's accent color, not a neutral.

### Touched Code

- `js/timeline.js`: add count to `rowHTML` header; update `tl-day-hd` markup to `flex` with count span.
- `styles.css`: `.tl-chipbar` scrollbar rules; `.tl-row` border-bottom; `.tl-back` background update; `.tl-day-hd` flex layout; `.tl-day-ct` style.
- `index.html`, `sw.js`: bump version.

### Verification

- Day headers read "Today · 4" with the count right-aligned.
- Chipbar scrolls horizontally on a narrow viewport with no scrollbar indicator visible.
- Rows inside a day card have hairline dividers except the last row.
- Back button shows accent-tint fill matching the app palette.
- Playwright test: navigate to Timeline from Home, assert `.tl-day-ct` text matches entry count; assert `.tl-back` computed background equals the accent-tint token.
