---
title: Dogfood batch — Solids tracking, tab-bar restructure, diaper copy
date: 2026-08-15
status: draft
---

# Dogfood batch: Solids tracking, tab-bar restructure, diaper copy

Three bundled changes from a single round of dogfood feedback. Grouped into
one spec because they're all small and shipping together, but each is an
independently reviewable/implementable unit.

## 1. Solids feeding log

### Goal

Track solid-food feeding as its own log type: what food, how much, and how
the baby reacted, so a parent can build a picture of what's been tried and
what to watch for (likes, dislikes, allergies).

### Entry type

New top-level type `solid`, added alongside `sleep` / `feed` / `bottle` /
`diaper` / `medicine` in the log-type chooser (`sheets.js` `openTypeChooser`).
Not a variant of the existing Feed form — solids is a distinct feeding stage
the app doesn't currently model.

### Data shape

```js
{
  id, type: 'solid', time,
  foods: [
    { food: 'Banana', amount: 'Some', reaction: 'Likes', allergy: false },
    { food: 'Oatmeal', amount: 'Little', reaction: 'Unsure', allergy: false }
  ],
  note: 'Fussy today, distracted by the dog'
}
```

- `foods` is a repeatable array — one meal can log multiple foods, each with
  its own amount/reaction/allergy flag. An "Add another food" button appends
  a row in the entry sheet.
- `note` is a single shared free-text field for the whole entry (matches
  every other log type — one notes field per entry, not per food row).
- Stored as JSON on the entry, same as other structured fields already do.
  `normalizeLog` (`store.js`) gets a forward-compatible default (`foods: []`)
  for entries that predate this field, mirroring the existing Mixed-diaper
  migration pattern at `store.js:89`.

### Food picker

- A curated list of common first foods, grouped (fruits, vegetables,
  grains/starches, proteins, common allergens — peanut, egg, dairy, tree
  nut, wheat, soy, fish/shellfish, sesame). Exact list finalized during
  implementation; roughly 30-40 entries is the right order of magnitude.
- Rendered as a tappable icon grid (same pattern as the sleep-method
  `iconGrid` in `sheets.js:487`), one icon per food.
- An "Other" tile reveals a free-text input for anything not on the list.
  Previously-typed custom food names are remembered and offered back as
  autocomplete suggestions the next time (same memory pattern as
  `defaultBottleAmount`, `store.js`/`sheets.js`), so a repeated custom food
  doesn't need retyping.

### Food icons

- One-time batch generation via `fal.ai`, one icon per curated food, in the
  app's existing hand-illustrated visual style (matching the tone of the
  existing `assets/sky/*.webp` art, not a generic icon-font look). Saved as
  local static assets, not fetched at runtime — same treatment as the sky
  assets. This is a deliberate exception to the "Lucide icons only" rule,
  scoped narrowly to food icons, since Lucide has no meaningful food-icon
  coverage.
- Custom/"Other" foods that have no generated icon fall back to a generic
  utensils icon (Lucide `utensils`).
- Art-direction and generation is an implementation-time task, not decided
  in this spec — see the plan.

### Amount

Segmented control: `None / Little / Some / Most / All`. A "custom" toggle
next to it swaps in a free-text field for anything more specific (e.g. "2
tbsp", "half a jar"), same toggle pattern as the food picker's Other tile.

### Reaction

Two independent controls per food row, not one combined scale:

- **Taste range**: 4 fun icons, Hates it → Unsure → Likes it → Loves it.
  Exact icon set (e.g. face expressions) chosen during implementation,
  consistent with the food-icon art style.
- **Allergy/sensitivity**: a separate toggle/switch (same `switch`/`knob`
  component the diaper form already uses for Rash, `sheets.js:513`),
  independent of the taste pick. Kept separate because it's a safety signal,
  not a preference — conflating "didn't like it" with "reacted to it" would
  bury the more important signal.

### Home card

New "Solids" card on Home, same footprint/pattern as the existing
Sleep/Feed/Diaper cards: shows last meal + time since, tap to quick-log.

### Foods-tried rollup view

New screen reached from the Solids Home card (a "Foods tried" link,
matching the Today card's existing link-to-detail-view pattern). Derived
entirely from existing log data — no separate food-library table:

- One row per distinct food ever logged.
- Shows: food icon, name, latest reaction, times tried, last-tried date,
  allergy flag if ever marked.
- Sortable by: name, most recently tried, reaction, with allergy-flagged
  foods promotable to the top (e.g. a sort option or a persistent
  allergy-first grouping — implementation detail, not fixed here).

### Out of scope for this pass

- No separate "known allergies" list surfaced outside this rollup view
  (e.g. no Profile banner). The rollup view itself covers the "sortable by
  allergy" ask.
- No nutrition tracking, no age-appropriateness warnings, no reminder
  scheduling for solids (unlike the existing bottle reminder).

## 2. Tab-bar restructure

### Current state

`TABS` in `app.js`: `[home, sleep, trends, growth, profile]`. The day-log
(`js/timeline.js`) is not a bottom tab today — it's reached via a "Timeline"
link on Home's Today card (`home.js:507`).

### Target state

`TABS` becomes `[home, sleep, timeline, insights, profile]` — same count
(5), two tabs change identity:

- **`timeline`** (day-log) is promoted from a Home-card link to a real
  bottom tab. The Home → Timeline link on the Today card is removed (the
  bottom tab is now the only path there).
- **`insights`** is a new tab replacing both `trends` and `growth`. It
  renders both existing views' content on one long scroll: **Trends
  first, then Growth**, in that order. Each section reuses its existing
  render function (`trends()`, `growth()`) rather than being rewritten —
  this is a container/navigation change, not a rewrite of either view's
  internals. The `VIEWS` map and `enterTrends()`-style per-view animation
  hooks in `app.js` get merged accordingly (both sections' animations fire
  on entry to the single `insights` view).
- Icon: `insights` keeps `chart-bar` (Trends' current icon). `sleep` /
  `home` / `profile` icons unchanged. `timeline` gets its own icon,
  distinct from `chart-bar` — a list/log icon such as `scroll-text`, chosen
  during implementation.

### Out of scope

No change to the Growth or Trends views' own internal content, charts, or
insight cards — only their container and navigation entry point change.

## 3. Diaper copy: "Dirty" → "Poo"

UI-copy-only change. Every **user-facing** label reading "Dirty" becomes
"Poo":

- The diaper-type segmented control (`sheets.js:509`)
- Home card / entry summary text (`home.js`, `ui.js` wherever `kind` is
  rendered to the user)
- Changelog wording going forward (not retroactive edits to past changelog
  entries)

**Not changed:** the internal `kind: 'Dirty'` stored value, the `wetSize`/
`dirtySize` field names, existing migrations (`store.js:89`), and existing
tests that assert on `'Dirty'` as data (`store.test.js:295-313`). This is
purely a label swap at render time — zero data-model or migration risk.

## Testing

- Unit tests (`js/store.test.js`): `normalizeLog` default for `foods`,
  any new `derive` helpers for the Home card / rollup view.
- Playwright: a new solids-logging spec (add entry with 2+ foods, verify
  Home card + rollup view + Timeline display); tab-bar navigation spec
  updates for the new `timeline`/`insights` tabs; existing diaper spec(s)
  updated for the new label text only, not the underlying `Dirty` value.
- No server/schema changes required — `foods` rides in the existing
  entry-JSON storage path, same as other structured entry fields.
