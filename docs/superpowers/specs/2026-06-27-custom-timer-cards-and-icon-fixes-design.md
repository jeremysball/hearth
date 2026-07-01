# Design — Custom timer cards, icon fixes, moon, Today spacing

Date: 2026-06-27
Branch: `feat/sleep-card-redesign`

Four changes to the home view.

## 1. Icon fixes — medicine, bottle, diaper

The custom filled SVG symbols in `index.html` read poorly:

- `#icon-medicine` — solid rotated capsule with a faint seam; reads as a blob.
  Redraw as a clearer two-tone capsule: two distinct halves with a visible
  dividing line across the pill.
- `#icon-bottle` — highlight / measure marks are misplaced. Clean the
  silhouette so it reads as a baby bottle (neck, body, level marks).
- `#icon-diaper` — currently an hourglass / bowtie (two triangles meeting);
  does not read as a diaper. Redraw as a folded-diaper silhouette (wide tabbed
  top tapering to a rounded crotch).

Verify before/after by rendering the running app, not by eye on the path data.

## 2. Today list spacing

In `.row-txt` (`styles.css`) the title `.what` and detail `.when` are stacked
in a flex column with no gap. Add a small vertical gap (~2–3px) so the title
and time breathe.

## 3. Moon instead of stars

`.card.hero::before` paints a moon-glow plus **five white star dots**
(`radial-gradient(circle …)` layers). Remove the five star-dot layers and add a
real crescent **moon** using the already-vendored `#moon` SVG symbol, positioned
top-right inside the existing glow. Keep the soft moon-glow ellipses as ambient
backing. The moon appears in both awake and asleep hero states.

## 4. User-addable timer cards

Today the home info-stack has exactly two cards — **bottle** ("food") and
**medicine** — hard-coded via `CARD_KEYS` / `CARD_RENDER` in `home.js`. Each
predicts a "next due" time from an interval. Goal: let the user add a timer card
for any activity type, while the default stays bottle + medicine only.

### Eligible types

All loggable types **except `note`**: sleep, feed, bottle, diaper, medicine,
play, bath, pump. `bottle` and `medicine` keep their existing special
renderers; the rest use a shared generic renderer.

### Data model — extend `settings.cards`

```
cards: {
  bottle: true,            // visibility booleans for the two defaults
  medicine: true,
  order: ['bottle', 'medicine'],   // display order; may also hold custom type keys
  intervals: { play: 3 }   // hours, ONLY for generic custom cards
}
```

- A generic card renders only if its type key is present in `order`, is visible
  (`cards[key] !== false`), **and** has an entry in `cards.intervals`. The
  `intervals` gate means legacy saved state containing a stray `sleep: true`
  (from the old default) will NOT suddenly render a card — clean migration with
  no data rewrite.
- `DEFAULT` changes its cards to `order: ['bottle', 'medicine']` (drops the
  unused `sleep`) so a fresh install shows only the two defaults.
- New custom cards default to **every 3h**.
- `enqueueSettingsSync` already syncs the whole `cards` object, so `intervals`
  rides along with no server change.

### Generic prediction

Add `derive.nextForType(type)` to `store.js`:

- `last` = most recent log entry of `type` (log is sorted newest-first).
- `anchor` = `last.end || last.start` (so a sleep card predicts from last wake;
  others from the last occurrence). If no entry exists, anchor = now − interval
  (i.e. due now).
- `due` = `anchor + intervalH hours`.

Generic card markup mirrors the bottle card:
`Next {TYPES[type].label} · every {N}h`, value = `clock(due)` + relative
("in 2h" / "due now"), with the type's tone ring and icon.

### Flows

- **Add card:** an "+ Add card" button under the info-stack opens a picker sheet
  (`openCardPicker`) listing eligible types not currently shown as a card.
  - Re-adding a hidden default (bottle/medicine) → `showCard` (unhide), refresh.
  - A generic type → open an interval stepper sheet (default 3h) → on save push
    the type to `order`, set `cards.intervals[type]`, mark visible, refresh.
- **Edit (gear icon):** generic cards open a sheet with an interval stepper and a
  "Remove card" button. Remove deletes the type from `order` and `intervals`.
  Bottle and medicine edit sheets are unchanged.
- The existing long-press reorder / hidden-row chips continue to work; chip
  labels come from `TYPES[k].label` so they generalize beyond bottle/medicine.

### Testing

Unit test `derive.nextForType` in `store.test.js`: anchor from `end` when the
last entry has one, from `start` otherwise, and the no-entry (due-now) case.

## Version bump

All four changes touch cached assets (`index.html`, `styles.css`, `js/*`), so
bump `<meta name="version">` and `sw.js` `VERSION` to the current UTC timestamp
per the project rule.
