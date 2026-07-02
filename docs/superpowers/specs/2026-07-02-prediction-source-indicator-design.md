# Prediction Source Indicator Design

## Goal

Surface, in the UI, whether the SweetSpot nap-window prediction is a generic population estimate, a blend, or personalized to the baby's own logged naps — so parents can tell how much to trust the window.

## Current State

`derive.wakeWindowPrediction()` in `js/store.js` already computes and returns a `source` field (`'population' | 'blend' | 'personal'`), a `sampleSize`, and a human-readable `label` (e.g. `typical for 3mo`, `based on Rae's recent naps`, `based on Rae's pattern`). This `label` is rendered as plain caption text in two places:

- `js/home.js:265` — hero rail caption (`.sh-rail-cap` second `<span>`)
- `js/sleep.js:127` — SweetSpot schedule card header (`.chart-note`)

The distinction between the three source states is not visually distinct today — it's easy to miss in small caption text, and there's no way to see sample size or get more explanation.

## Scope

Header-level indicator only, in the two locations above. The sleep view's per-window SweetSpot schedule rows (`schedHTML` in `js/sleep.js`) are unaffected — they don't show per-row prediction detail today and won't gain any with this change.

## Design

### Source-state mapping

Add a small pure helper, `predictionSourceInfo(prediction)`, in `js/sleep.js` (only two call sites; keep local rather than promoting to `ui.js`):

```js
function predictionSourceInfo(prediction) {
  const name = state().baby.name || 'your baby';
  const n = prediction?.sampleSize || 0;
  switch (prediction?.source) {
    case 'personal':
      return {
        cls: 'src-personal',
        heading: `Personalized to ${name}`,
        body: `Based on ${name}'s own nap pattern from the last 21 days (${n} naps logged).`,
      };
    case 'blend':
      return {
        cls: 'src-learning',
        heading: `Learning ${name}'s pattern`,
        body: `Blending ${name}'s own naps with typical ranges for this age (${n} nap${n === 1 ? '' : 's'} logged in the last 21 days). Personalizes further as you log more.`,
      };
    default:
      return {
        cls: 'src-generic',
        heading: 'Generic estimate',
        body: `Not enough naps logged yet, so this window uses typical timing for this age. Log a few more naps to personalize it.`,
      };
  }
}
```

Import and reuse this from `js/home.js` (named export from `sleep.js`, matching the existing cross-file export pattern already used elsewhere in the codebase).

### Visual treatment

Reuse the existing `#info` sprite icon — no new icons to vendor. Render it as a small button next to the caption text, with a CSS class from `predictionSourceInfo().cls` controlling opacity/color:

- `.src-generic` — muted/dim, low visual weight (matches "just a default")
- `.src-learning` — amber, partial opacity (visibly "in progress")
- `.src-personal` — gold/full opacity (matches the app's existing gold "caught ember" SweetSpot language)

Markup pattern for both call sites:

```html
<button class="src-info-btn {cls}" data-action="prediction:info" aria-label="About this prediction">
  <svg class="icon"><use href="#info"></use></svg>
</button>
```

### Tap behavior

Wire `data-action="prediction:info"` into the existing delegated click handler in `app.js`. On click, call `sheet.open()` with a small sheet:

```html
<div class="sheet-hd">{heading}</div>
<p class="sheet-body">{body}</p>
```

Reuse existing sheet styles; no new sheet chrome needed. The handler reads the current `derive.sweetSpot().prediction`, calls `predictionSourceInfo()`, and passes the result into the sheet markup.

## Styles

Add to `styles.css`:

- `.src-info-btn` — small tappable icon button, sized/positioned to sit inline with the existing caption text
- `.src-generic`, `.src-learning`, `.src-personal` — color/opacity variants applied to the icon

## Tests

- Unit test (`js/store.test.js` or a new `js/sleep.test.js` if one doesn't exist) for `predictionSourceInfo()` covering all three `source` values, including `sampleSize: 0` and the `n === 1` singular-nap wording edge case.
- Existing Playwright suites touching `home.js` and `sleep.js` should still pass; add a small assertion if a suite already exercises the SweetSpot caption area, confirming the info button renders and opens a sheet.

Run for touched files:

- `node --test js/store.test.js` (and new test file if added)
- Relevant Playwright suite(s) for `home.js` / `sleep.js`
- `npm run check`

Run `scripts/bump-version.sh` before finishing — this changes cached frontend assets (`js/`, `styles.css`).
