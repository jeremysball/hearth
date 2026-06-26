# UX Improvements — Design Spec
**Date:** 2026-06-26  
**Branch:** ux-improvements

---

## 1. Onboarding cleanup

### Remove Day Job themes and section headers

The onboarding theme picker currently shows two labelled sections — "Original" and "Day Job" — each with Girl/Boy variants. Day Job themes will be removed from onboarding entirely.

**Change:** Replace the `theme-set` block in `onboarding.js` with a flat two-button row (Girl, Boy). No section headers. The `dayjob-girl` and `dayjob-boy` options remain available in Profile settings but are not shown to first-run users.

### Fix dark mode on theme buttons

`.theme-opt` uses `var(--surface)` for its background, which correctly resolves to a dark value when `[data-mode="dark"]` is on `<body>`. However, the box-shadow includes a hard-coded white top highlight (`inset 0 1px 0 oklch(1 0 0 / .75)`) that looks harsh in dark mode.

**Change:** Add a `[data-mode="dark"] .theme-opt` override that drops the inset highlight opacity to ~0.15 and replaces it with a subtle inner glow. Also confirm `applyTheme()` is called during initial boot before the onboarding view renders, so `data-mode` is set on first open.

---

## 2. Quick action icons

### Icons showing as empty circles

The `.tok` circles in the quick actions bar contain `<svg class="icon"><use href="#..."></use></svg>` referencing symbols from the inline sprite (`<svg style="display:none">` in `<body>`). The icons are stroke-based (`stroke="currentColor"`), relying on CSS `color` inheritance. The recent skeuomorphic button commit introduced a white radial gradient overlay (`oklch(1 0 0 / .42)`) that may be washing out icon strokes, or `currentColor` is not reaching the SVG properly.

**Investigation:** Verify in-browser that `color` is set on `.tok` and inherits to the SVG's `currentColor`. If the gradient is the problem, tuning it (see §4) may resolve visibility. If the SVG `use` reference itself is broken, check that the sprite SVG is not inside a shadow root and that `href` (not `xlink:href`) is used.

**Change:** Ensure all five quick action icons render visibly. Additionally, change the `feed` (Nursing) type icon from `droplet` to `baby` (already in sprite) so Nursing and Diaper are visually distinct.

```js
// ui.js TYPES
feed: { icon: 'baby', label: 'Nursing', tone: 'feed' },
```

---

## 3. Drag-select segmented controls (diaper Type + Size)

The diaper form's Type (`Wet / Dirty / Mixed`) and Size (`Small / Medium / Large`) controls use `.segctl` — a tap-only segmented control. A press-and-drag interaction is added to these two controls only, scoped via `data-draggable` attribute.

### Interaction model

**Long-press activation (350 ms, no movement):**
- Scale the entire `.segctl` to `1.06×` with spring easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`, 300 ms).
- Fire a short haptic buzz (`navigator.vibrate(8)` or equivalent via `buzz()`).
- Capture the pointer on the segctl element so drag continues off-element.

**During drag:**
- Track `clientX` to determine which option the finger is over.
- Highlight the nearest option in real-time (toggle `.on` as finger moves).
- Dim the non-hovered options slightly (`opacity: 0.6`).

**Release:**
- Commit the nearest option.
- Scale back to `1×` with the same spring easing.
- Fire a short haptic tick (`tick()`).

### Implementation notes

- Add `data-draggable` to the two `seg()` calls in `sheets.js` for `kind` and `size` on the diaper form.
- A new `bindDragSeg(el)` function in `sheets.js` (or `ui.js`) attaches the pointer event handlers.
- Long-press timer is cancelled on `pointermove` beyond a 4px threshold (prevents accidental activation during scroll).
- Does not interfere with tap-to-select, which remains the fallback when long-press is not triggered.

---

## 4. Button gradient lighting

### Tok circles

Current gradient:
```css
radial-gradient(circle at 33% 28%, oklch(1 0 0 / .42) 0%, transparent 55%)
```

The white blob at 33%/28% reads as a harsh splotch on a 46px circle.

**Change:**
```css
radial-gradient(circle at 40% 22%, oklch(1 0 0 / .28) 0%, transparent 65%)
```
- Center shifted slightly toward top-center (40% 22%).
- Opacity reduced from 0.42 → 0.28.
- Spread extended from 55% → 65% for softer feathering.

This softens the highlight into a natural specular reflection while keeping the skeuomorphic quality.

---

## 5. Time input overflow

The `input[type="datetime-local"]` in the quick-log sheet extends to the right edge of the screen, ignoring the sheet's 22px horizontal padding.

**Root cause:** Browsers enforce a native minimum width on datetime-local inputs that overrides `width: 100%` in some rendering paths.

**Change:**
```css
input[type="datetime-local"] {
  min-width: 0;
  max-width: 100%;
}
```
Also add `overflow: hidden` to `.sheet-body` as a containment guard.

---

## 6. Glassmorphism (deferred — implement last)

After all other items are stable, introduce a glass aesthetic:

- Hero card, info cards, and sheet: `backdrop-filter: blur(14px)` with semi-transparent surface backgrounds (e.g. `oklch(0.98 0.012 70 / 0.72)` in light mode, `oklch(0.24 0.016 55 / 0.70)` in dark mode).
- Requires the page background gradient to show through — existing `radial-gradient` on `body` is the blur source.
- Provide `@supports (backdrop-filter: blur(1px))` fallback (opaque surface for unsupported browsers).
- Keep existing `border-radius` and `box-shadow` values; glass replaces only the background fill, not the shape or shadow.

---

## Out of scope

- Removing Day Job themes from Profile settings.
- Changes to the sleep, feed, bottle, or medicine log forms.
- Any backend changes.
