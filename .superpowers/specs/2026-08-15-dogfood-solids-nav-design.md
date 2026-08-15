---
title: Dogfood batch — Solids tracking, tab-bar restructure, diaper copy
date: 2026-08-15
status: draft
---

# Dogfood batch: Solids tracking, tab-bar restructure, diaper copy

Three pieces of feedback from one dogfood round. Each ships as its own
independent branch/PR, in this order, smallest/lowest-risk first:

1. **Diaper copy** ("Dirty" → "Poo") — copy-only, zero data-model risk.
2. **Tab-bar restructure** (Timeline promoted to a tab, Trends+Growth merged
   into Insights) — navigation/container change, no new data.
3. **Solids feeding log** — the largest, most novel piece; a new entry type,
   new form machinery, a new Home card, a new rollup view.

Each unit is independently reviewable and mergeable; none blocks the others.
Revised after independent review from two external models (muse,
gpt-5.6-terra max) — see "Review findings incorporated" at the bottom of
each section for what changed from the first draft.

## 1. Diaper copy: "Dirty" → "Poo"

UI-copy-only change. Every **user-facing** label reading "Dirty" becomes
"Poo," including the "Dirty size" field label (missed in the first draft):

- The diaper-type segmented control (`sheets.js:509`, `seg('kind', ['Wet',
  'Dirty', 'Mixed'], 'Wet')` → label text `'Poo'` for the `Dirty` option;
  the underlying value stays `'Dirty'`, see below).
- The "Dirty size" field label wherever it's rendered (same form, the
  size sub-control shown when `kind` is `Dirty`/`Mixed`) → "Poo size."
- Home card / entry summary text (`home.js:29-33`'s `'Diaper · ' +
  (e.kind || '').toLowerCase()` and any other spot `kind` renders to the
  user).
- Changelog wording going forward (not retroactive edits to past changelog
  entries).

**Not changed:** the internal `kind: 'Dirty'` stored value, the `wetSize`/
`dirtySize` field names, existing migrations (`store.js:89`), and existing
tests that assert on `'Dirty'`/`'dirtySize'` as data (`store.test.js:295-313`
and any other data-level assertion). This is purely a label swap at render
time — zero data-model or migration risk. Test files that assert on
*rendered copy* ("Dirty" appearing in the DOM) do need updating to expect
"Poo" instead; test files asserting on the `kind`/`dirtySize` data fields
do not.

## 2. Tab-bar restructure

### Current state

`TABS` in `app.js`: `[home, sleep, trends, growth, profile]`. The day-log
(`js/timeline.js`) is not a bottom tab today — it's reached via a "Timeline"
link on Home's Today card (`home.js:507`).

### Target state

`TABS` becomes `[home, sleep, timeline, insights, profile]` — same count
(5), two tabs change identity:

- **`timeline`** (day-log) is promoted from a Home-card link to a real
  bottom tab. The Home → Timeline link on the Today card (`home.js:507`) is
  removed — the bottom tab is the only path there now.
- **`insights`** is a new tab replacing both `trends` and `growth`. It
  renders both existing views' content on one long scroll: **Trends first,
  then Growth**, in that order.
- Icon: `insights` keeps `chart-bar` (Trends' current icon). `sleep` /
  `home` / `profile` icons unchanged. `timeline` gets its own icon, distinct
  from `chart-bar` — a list/log icon such as `scroll-text`, chosen during
  implementation.

### Insights composition — precise contract

Both reviews flagged the original "just concatenate `trends()` +
`growth()`" description as underselling real integration work. Concretely:

- **Container**: a single `insights` view wraps both sections in one
  scrollable flex column (`.screen` already supports this per
  `styles.css:181`), each section keeping its own internal markup/styling
  unchanged. No rewrite of either view's internal content, charts, or
  insight cards.
- **View-entry hook collision**: `app.js`'s router currently branches
  per-view on entry (`app.js:116-118`: `if (view === 'trends')
  enterTrends(); else if (view === 'sleep') enterSleep(); else if (view ===
  'growth') enterGrowth();`). The new `insights` case calls **both**
  `enterTrends()` and `enterGrowth()` in sequence on entry to the single
  view — the branch becomes `else if (view === 'insights') {
  enterTrends(); enterGrowth(); }`. Both existing functions keep their
  current signatures; only the call site changes.
- **`shownStat` singleton**: `growth.js`'s `shownStat` module-level variable
  (`growth.js:40-47`) tracks which stat's detail is currently expanded. It's
  safe to keep as-is *only* because Growth still owns its own DOM subtree
  and only `enterGrowth()` touches it — merging the container doesn't
  change Growth's internal lifecycle, so no explicit reset/reconciliation
  logic is needed beyond calling `enterGrowth()` normally on each entry to
  `insights` (which it already does today on each entry to the standalone
  `growth` view).
- **One-shot animations**: any animation in either view keyed to first
  becoming visible (e.g. a Growth chart draw-in) fires on `enterGrowth()`
  being called, same as today — no new "became visible" detection needed
  since both functions already run unconditionally on view entry, and
  `insights` entry now always calls both.
- The `VIEWS` map (`app.js:27`) drops the standalone `trends`/`growth`
  entries and gains `insights`.

### `profile.js` copy update

`profile.js:126` has stale copy referencing "the Growth tab" by name. Update
it to reference "Insights" (or drop the tab name and describe the feature
generically, whichever reads better in context — implementation-time
wording call, not a design decision).

### Out of scope

No change to the Growth or Trends views' own internal content, charts, or
insight cards — only their container and navigation entry point change.

## 3. Solids feeding log

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
  id, type: 'solid', start,          // `start`, not `time` — matches every
                                      // other entry type (store.js:129, 151;
                                      // timeline.js dayKey(e.start))
  foods: [
    { key: 'banana', label: 'Banana', amount: 'Some', amountCustom: null,
      reaction: 'likes', allergy: false },
    { key: 'oatmeal', label: 'Oatmeal', amount: null, amountCustom: '2 tbsp',
      reaction: 'unsure', allergy: false }
  ],
  note: 'Fussy today, distracted by the dog'
}
```

- `foods` is a **native JS array of plain objects**, held as a normal field
  on the in-memory entry object — no client-side `JSON.stringify`/`parse`
  step anywhere in `store.js`/`sheets.js`. It rides through the same
  serialize/deserialize path every other structured entry field already
  uses (the store's top-level object gets persisted as JSON as a whole;
  `foods` is just one more field inside that object, same treatment as
  e.g. `dirtySize`). The original spec's phrasing ("serializes as JSON in
  the entry") was ambiguous about this and is corrected here: nothing
  double-encodes `foods` as a JSON *string* value.
- `key` is a stable catalog identifier (lowercase-kebab, e.g. `'banana'`,
  `'peanut-butter'`) used to group rollup rows and to match icons; `label`
  is the display string (needed for custom/"Other" foods, which have no
  catalog `key` — a custom entry gets `key: null` and only `label` set).
  The rollup view (below) groups by `key` when present, falling back to a
  case-insensitive `label` match for custom foods.
- `amount` holds one of the segmented-control values (`'None' | 'Little' |
  'Some' | 'Most' | 'All'`); `amountCustom` holds free text when the custom
  toggle is used instead. Exactly one of the two is non-null per row.
- `reaction` is one of `'hates' | 'unsure' | 'likes' | 'loves'` (lowercase
  enum values, matching the app's existing convention of lowercase internal
  values with capitalized display labels — see `kind: 'Dirty'` vs. its
  "Poo" display label above for the same pattern).
- `allergy` is an independent boolean per food row (see Reaction section).
- `note` is a single shared free-text field for the whole entry (matches
  every other log type — one notes field per entry, not per food row).

### `normalizeLog` and sync-ingress handling

The first draft proposed a bare `foods: []` default in `normalizeLog`
mirroring the Mixed-diaper-size migration at `store.js:89`. Both reviews
flagged this as insufficient: `normalizeLog` only runs on the
localStorage-load path, not on `applySyncResponse` (`store.js:1010-1014`),
which merges entries arriving from sync directly. A pre-`solid`-feature
sync payload, or a malformed one from a buggy client, would bypass the
default entirely.

Corrected handling:

- Add a small shared `normalizeSolidFoods(foods)` helper: returns `[]` for
  `null`/`undefined`/non-array input, and for a non-empty array, filters out
  any row missing both `key` and `label` (unrecoverable — no way to display
  it) rather than passing malformed rows through silently.
- Call `normalizeSolidFoods` from **both** `normalizeLog` (the
  localStorage-load path) and `applySyncResponse` (the sync-ingress path),
  not just the former. This is the one place the spec adds a genuinely new
  cross-cutting rule: any future entry field that can arrive from sync
  needs its default/sanitize step applied on both paths, not just
  `normalizeLog`.
- No schema migration needed server-side (see Server/asset changes below) —
  this is a client-side sanitization concern only.

### Sync / conflict policy

Not addressed at all in the first draft. Decision: **entry-level
last-write-wins**, same as every other entry type today (`sync.js:183-189`'s
existing merge-by-id logic needs no change). If two caregivers log solids
for the same meal concurrently, whichever entry's sync write lands last
wins in full — no per-food-row merge. This is a deliberate YAGNI call: the
app has no existing precedent for field-level merge on any entry type, and
introducing one just for `foods` would be new complexity solids doesn't
need yet. Documented here explicitly so it's not silently assumed.

### Food picker

- A curated list of common first foods, grouped (fruits, vegetables,
  grains/starches, proteins, common allergens — peanut, egg, dairy, tree
  nut, wheat, soy, fish/shellfish, sesame). Exact list finalized during
  implementation; roughly 30-40 entries is the right order of magnitude.
  Each catalog entry is `{ key, label, group, icon }`.
- Rendered as a tappable icon grid using the existing `iconGrid()` helper
  (`sheets.js:20-24`). Note for implementation: `iconGrid()` currently
  renders from the Lucide SVG sprite (`<use href="#...">`) only — it has no
  path for an arbitrary raster image. Food icons (see below) are `<img>`
  elements, not sprite refs, so `iconGrid()` needs a small extension (an
  `img` source option per tile) rather than being reusable unmodified. This
  is new, small machinery, not a drop-in reuse.
- An "Other" tile reveals a free-text input for anything not on the list.
  Previously-typed custom food names are remembered and offered back as
  autocomplete suggestions the next time (same memory pattern as
  `defaultBottleAmount`, `sheets.js:471`), so a repeated custom food doesn't
  need retyping. A remembered custom food gets `key: null`, `label:
  <typed text>`.

### Food icons

- One-time batch generation via `fal.ai`, one icon per curated food, in the
  app's existing hand-illustrated visual style (matching the tone of the
  existing `assets/sky/*.webp` art, not a generic icon-font look). Saved as
  local static assets, not fetched at runtime — same treatment as the sky
  assets. This is a deliberate exception to the "Lucide icons only" rule,
  scoped narrowly to food icons, since Lucide has no meaningful food-icon
  coverage.
- Custom/"Other" foods that have no generated icon fall back to a generic
  utensils icon (Lucide `utensils`, via the sprite, not an `<img>`).
- **Service-worker cache-install risk** (terra-max finding): `sw.js:42-46`'s
  install step does `cache.addAll([...])` over the full asset manifest,
  which fails atomically if any single URL 404s — one bad food-icon asset
  path would break the *entire* offline install, not just food icons.
  Mitigation: add the new food-icon assets to the precache manifest only
  after confirming every file exists and loads (a quick local check as part
  of the implementation step, before merging), and prefer generating a few
  extra/placeholder icons over shipping a manifest entry for an icon that
  doesn't yet exist.
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
  independent of the taste pick. Kept separate because it's a safety
  signal, not a preference — conflating "didn't like it" with "reacted to
  it" would bury the more important signal.

### Multi-food form: new row-scoped machinery

The first draft's "an 'Add another food' button appends a row" undersold
the real work here — both reviews flagged it. `sheets.js`'s existing
pattern (`segVal()`/`setSeg()`, `sheets.js:466`, `654-657`) reads/writes a
single global selector value per control name and has no concept of "the
Nth row's amount control" — it's fundamentally single-row. The solids form
needs new, purpose-built machinery instead of reusing that pattern
unmodified:

- Each food row gets a unique row id (index-based is fine, since rows are
  only ever appended/removed within one open sheet session, never
  reordered).
- A new `gatherFoodRows()` function (parallel to the existing `gather()` at
  `sheets.js:550`, but row-aware) walks the DOM for all current row
  elements and reads each row's own food-picker selection, amount control,
  reaction control, and allergy toggle — scoped by row id, not by a global
  control-name lookup.
- "Add another food" appends a new row's markup (food picker collapsed to a
  compact "choose food" tile until tapped, matching how the first row
  looks before a food is picked) and assigns it the next row id. A row can
  be removed via a small delete affordance once at least one row remains
  (the form always keeps at least one row visible).
- `gather()` (the whole-form collector) calls `gatherFoodRows()` for the
  `foods` field instead of a single `segVal()` lookup, same as it already
  composes other fields today.

### Home card

New "Solids" card on Home, same visual footprint as the existing
Sleep/Feed/Diaper cards, but **not** built on the existing `genericCard()`
helper (`home.js:365-375`) unmodified. `genericCard()` is coupled to the
reminder-interval scheduling system (`server/push.go:527-555` schedules a
push reminder on a fixed interval per card type) — Solids has no reminder
scheduling (see Out of scope) and forcing it through `genericCard()` would
either need a fake/disabled interval or fork the helper's behavior.
Concretely: add a `solid` variant that renders the same visual shell
(icon, "last meal + time since," tap-to-quick-log) but skips the
reminder-interval wiring `genericCard()` assumes. A "Foods tried" link on
this card goes to the rollup view below.

### New-family card-default rollout

Not addressed in the first draft ("no server/schema changes" was the
original, inaccurate claim). No SQLite schema migration is needed — the
Solids card's presence/order is client-side state, same as other
`CARD_TYPES` entries. But **new families created after this ships need
`solid` included in whatever default card set a fresh family gets** —
check wherever that default list is set (client-side onboarding state, not
server schema) and add `solid` to it alongside the existing default cards,
so a new user sees the Solids card out of the box rather than only
existing families that happen to migrate forward.

### Foods-tried rollup view

New screen reached from the Solids Home card (a "Foods tried" link,
matching the Today card's existing link-to-detail-view pattern). Derived
entirely from existing log data — no separate food-library table:

- One row per distinct food ever logged, grouped by `key` (falling back to
  case-insensitive `label` match for custom foods with no `key`, per the
  Data shape section above).
- Shows: food icon, name, latest reaction, times tried, last-tried date,
  allergy flag if ever marked (true if any historical row for that food had
  `allergy: true`, even if a later entry doesn't).
- Sortable by: name, most recently tried, reaction, with allergy-flagged
  foods promotable to the top (e.g. a sort option or a persistent
  allergy-first grouping — implementation detail, not fixed here).

### Registry updates required

Not called out explicitly in the first draft. Adding `solid` as a
first-class type touches several existing registries that enumerate known
types — miss any one of these and the new type renders broken or is
silently excluded:

- `ui.js:49-61`'s `TYPES` object — needs a `solid` entry (icon, tone/color)
  or `home.js`'s summary-card fallback rendering breaks for solids entries.
- `timeline.js:38-40`'s `FILTER_TYPES` — needs `solid` added or solids
  entries are invisible in the day-log's type filter.
- `home.js`'s `CARD_TYPES` (~line 444) — needs `solid` added (see Home card
  above).
- `sheets.js`'s `FORMS` object (~line 477) — needs a new `solid` form
  template alongside `sleep`/`feed`/`bottle`/`diaper`.
- Existing test files that enumerate known types by name (`store.test.js`
  and any Playwright spec that asserts on the full type list) need `solid`
  added to their expected sets.

### Out of scope for this pass

- No separate "known allergies" list surfaced outside this rollup view
  (e.g. no Profile banner). The rollup view itself covers the "sortable by
  allergy" ask.
- No nutrition tracking, no age-appropriateness warnings, no reminder
  scheduling for solids (unlike the existing bottle reminder) — this is why
  the Home card can't reuse `genericCard()` unmodified, see above.

## Testing

- Unit tests (`js/store.test.js`): `normalizeSolidFoods` behavior (both the
  `normalizeLog` and `applySyncResponse` call sites), any new `derive`
  helpers for the Home card / rollup view, updated type-enumeration
  assertions to include `solid`.
- Playwright: a new solids-logging spec (add entry with 2+ foods via
  `gatherFoodRows()`, verify Home card + rollup view + Timeline display);
  tab-bar navigation spec updates for the new `timeline`/`insights` tabs;
  existing diaper spec(s) updated for the new "Poo"/"Poo size" label text
  only, not the underlying `Dirty`/`dirtySize` values.
- No SQLite schema migration required — `foods` rides in the existing
  entry-JSON storage path as a native field, same as other structured entry
  fields. Server-side work is limited to the new-family default-card-set
  rollout (client-side default list, not schema) and validating the new
  `type: 'solid'` payload shape in `server/entries.go`'s existing
  type/`start`-field validation (`entries.go:23-29`) and upsert-on-conflict
  path (`entries.go:47-54`) — both already generic over `type`, so this is
  confirmation, not new logic, but worth an explicit test.
