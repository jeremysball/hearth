# Solids Feeding Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `solid` as a new first-class log type: a multi-food entry (each food with its own amount, taste reaction, and independent allergy flag), a shared note, a dedicated non-reminder Home card, and a "Foods tried" rollup view derived from existing log data.

**Architecture:** `solid` slots into every existing type registry (`TYPES`, `FILTER_TYPES`, `CARD_TYPES`, `FORMS`) the same way every other entry type does. The one genuinely new piece of machinery is the multi-food row UI: existing per-type-global helpers (`seg`/`segVal`/`setSeg`, `iconGrid`/`setIconGrid`) already scope by an arbitrary `data-seg`/`data-icongrid` group-name string, so giving each food row a unique, row-id-suffixed group name (`amount-0`, `reaction-1`, etc.) lets those helpers work unmodified — the new code is a small row-aware wrapper (`gatherFoodRows()`/`prefillFoodRows()`) that enumerates rows and calls the existing per-group helpers, plus a small `iconGrid()` extension to render an `<img>` for food icons (which have no Lucide sprite equivalent) alongside its existing sprite-`<use>` rendering. The Home card skips `genericCard()`'s reminder-interval scheduling entirely (Solids has none) via its own `CARD_RENDER` entry, same pattern already used by `bottleCard`/`medicineCard`/`bathCard`/`hygieneCard`. The rollup view follows the exact "non-tab view reached from a card, with a back-to-Home button" pattern `timeline.js` used before this batch's tab-bar restructure promoted it to a tab.

**Tech Stack:** Vanilla JS, no framework, Go+SQLite backend (no schema changes needed — `server/entries.go` is already fully generic over `type`; the one server-side edit this plan does make is a one-line addition to `server/push.go`'s reminder-exclusion map, Task 1 Step 4.5). Tests: `node --test js/store.test.js` (unit), Playwright specs under `tests/`, `go test ./server/...` for the backend confirmation test.

**Spec:** `.superpowers/specs/2026-08-15-dogfood-solids-nav-design.md`, Section 3 ("Solids feeding log")

## Global Constraints

- Entry field is `start`, never `time` — matches every other entry type (`store.js:129,151`; `timeline.js`'s `dayKey(e.start)`).
- `foods` is a native JS array of plain objects on the in-memory entry — never `JSON.stringify`'d client-side. It rides the same top-level-object persistence path every other structured field already uses.
- `reaction` values: lowercase enum `'hates' | 'unsure' | 'likes' | 'loves'`. `amount` values: `'None' | 'Little' | 'Some' | 'Most' | 'All'` (or `amountCustom` free text, mutually exclusive with `amount`).
- Sync/conflict policy: entry-level last-write-wins, same as every other type — no per-food-row merge. `sync.js:183-189`'s `mergeById` needs no change.
- No SQLite schema migration. `server/entries.go` needs no new logic, only a confirmation test.
- Lucide icons only for UI chrome (taste-range faces, utensils fallback); food icons are the one deliberate exception (fal.ai-generated, vendored as local static assets) per the project's icon rule.
- Follow Conventional Commits. Run `scripts/bump-version.sh` before the closing commit. Add a `feat` changelog entry to today's dated block in `js/changelog.js`.

---

### Task 1: Register `solid` in every type registry

**Files:**
- Modify: `js/ui.js:49-61` (`TYPES` object)
- Modify: `js/timeline.js` (`FILTER_TYPES`, currently built from `PINNED_FILTERS`/`OPTIONAL_FILTERS` at ~line 38-40)
- Modify: `js/home.js:444` (`CARD_TYPES` array)
- Modify: `js/sheets.js:719-720` (`openTypeChooser`'s hardcoded `types` array), `js/sheets.js` `pickCard(type)`'s no-interval-card branch (Step 4.5)
- Modify: `server/push.go`'s `excluded` map (~line 527, Step 4.5) — excludes `solid` from reminder scheduling, matching the spec
- Test: `js/store.test.js` (add/extend any test that enumerates known types by name — search the file for existing type-list assertions first)

**Interfaces:**
- Consumes: nothing new.
- Produces: `TYPES.solid` — `{ icon, label, tone }`, read by `summary()` (`home.js`), `openTypeChooser()` (`sheets.js`), and any other consumer of `TYPES`. Later tasks (the Home card, the form, the rollup view) rely on `TYPES.solid.label === 'Solids'` and `TYPES.solid.tone === 'solid'`.

- [ ] **Step 1: Add `solid` to `TYPES`**

In `js/ui.js`, add a new entry to the `TYPES` object (after `hygiene`, before the closing brace):

```js
  hygiene:  { icon: 'icon-hygiene',  label: 'Hygiene',  tone: 'hygiene' },
  solid:    { icon: 'utensils',      label: 'Solids',   tone: 'solid' },
  away:     { icon: 'door-open',     label: 'Away',     tone: 'note'   },
```

(Keeping `away` where it already is — just inserting `solid` above it, matching the object's existing order otherwise.)

Note: `tone: 'solid'` needs a matching CSS custom property/class (e.g. `.tone-solid`) — see Task 9 for the Home-card styling task, which is where this gets a real color; other `tone-*` classes are defined in `styles.css`, grep for `tone-diaper` to find the pattern before adding `tone-solid` alongside it.

- [ ] **Step 2: Add `solid` to the Timeline filter list**

In `js/timeline.js`, find:

```js
const PINNED_FILTERS = ['bottle', 'sleep', 'medicine'];
const OPTIONAL_FILTERS = ['feed', 'diaper', 'pump', 'note', 'play', 'bath', 'away'];
```

Add `'solid'` to `OPTIONAL_FILTERS` (it's a less-frequent activity than the pinned three, same tier as `diaper`/`play`):

```js
const OPTIONAL_FILTERS = ['feed', 'diaper', 'pump', 'note', 'play', 'bath', 'away', 'solid'];
```

- [ ] **Step 3: Add `solid` to `CARD_TYPES`**

In `js/home.js`, find:

```js
export const CARD_TYPES = ['feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'pump', 'hygiene'];
```

Change to:

```js
export const CARD_TYPES = ['feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'pump', 'hygiene', 'solid'];
```

This makes Solids addable via the existing card picker (`openCardPicker`/`addableCardTypes()`/`pickCard`) the same way a parent adds a Diaper or Play card today — there is no separate "shown by default" list to update; only `bottle` and `medicine` are pre-enabled for new families (`store.js:25`'s `cards: { bottle: true, medicine: true, order: ['bottle', 'medicine'], ... }`), and every other card type, Solids included, is opt-in.

- [ ] **Step 4: Add `solid` to the log-type chooser**

In `js/sheets.js`, find:

```js
export function openTypeChooser() {
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath', 'hygiene', 'away'];
```

Add `'solid'` (placed after `'diaper'`, matching its position in `CARD_TYPES`):

```js
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'solid', 'medicine', 'pump', 'note', 'play', 'bath', 'hygiene', 'away'];
```

- [ ] **Step 4.5: Exclude `solid` from the reminder-interval flows it doesn't have**

Solids has no reminder scheduling (per the spec and the Global Constraints above), but two existing places special-case which types skip the generic "Remind every (hours)" interval machinery, and both currently only cover `bath`/`hygiene` — `solid` needs to join that list in both, or the card-add flow will incorrectly prompt for a reminder interval and the push-scheduler will incorrectly try to schedule one.

In `js/sheets.js`, find `pickCard(type)`:

```js
    if (type === 'bath' || type === 'hygiene') {
```

Change to:

```js
    if (type === 'bath' || type === 'hygiene' || type === 'solid') {
```

In `server/push.go`, find the `excluded` map (~line 527):

```go
	excluded := map[string]bool{"bottle": true, "medicine": true, "hygiene": true}
```

Change to:

```go
	excluded := map[string]bool{"bottle": true, "medicine": true, "hygiene": true, "solid": true}
```

(`bath` is already missing from this map today — a pre-existing gap unrelated to this feature. Leave it alone; fixing it is out of scope for this plan.)

Note: `server/family.go`'s `defaultCardsJSON` (the new-family default `cards` value) does *not* need a `solid` entry — it already only pre-enables `bottle`/`medicine` for new families, and Solids is opt-in like every other non-default card type (`diaper`, `play`, etc.), consistent with Step 3 above. This is the one place in the plan where "no server code changes" no longer holds in full — `push.go` does need the one-line change above, even though `entries.go`/the schema genuinely need none.

- [ ] **Step 5: Write a failing test for the type registry**

In `js/store.test.js`, add (near any existing test that already imports `TYPES` from `ui.js`, or add the import if none exists):

```js
import { TYPES } from './ui.js';

test('solid is registered as a known type', () => {
  assert.ok(TYPES.solid, 'TYPES.solid should exist');
  assert.equal(TYPES.solid.label, 'Solids');
});
```

- [ ] **Step 6: Run the test to verify it passes** (this test can't meaningfully "fail first" in the TDD sense since Steps 1-4 already landed the change — run it now to confirm)

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add js/ui.js js/timeline.js js/home.js js/sheets.js js/store.test.js server/push.go
git commit -m "feat(solid): register the solid entry type across TYPES/FILTER_TYPES/CARD_TYPES/type-chooser"
```

---

### Task 2: Vendor the taste-range and utensils-fallback icons

**Files:**
- Modify: `index.html` (SVG sprite)

**Interfaces:**
- Consumes: nothing.
- Produces: `<symbol id="frown">`, `<symbol id="meh">`, `<symbol id="smile">`, `<symbol id="laugh">` (the 4-point taste range: Hates it → Unsure → Likes it → Loves it), and `<symbol id="utensils">` (the fallback icon for `TYPES.solid.icon` and for any custom food with no generated icon).

- [ ] **Step 1: Pull the canonical Lucide SVG source for all 5 icons**

Same rule as the tab-bar plan's icon task: do not hand-write path geometry. Pull `frown`, `meh`, `smile`, `laugh`, and `utensils` from a canonical Lucide source (`lucide-static` package output, or whatever tooling this repo already uses to vendor the existing sprite icons — check for a generation script before assuming manual copy-paste is the pattern).

- [ ] **Step 2: Add all 5 `<symbol>`s to the sprite**

Match the existing stroke-icon format (`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`), placed near the other plain Lucide icons (e.g. after `refresh-cw` at `index.html:239`, before the hand-illustrated `icon-*` symbols start at `index.html:245`).

- [ ] **Step 3: Visual sanity check**

Serve the app locally and confirm each new symbol renders a distinct, recognizable icon at ~20-24px (the app's typical icon size) via a temporary DOM edit in devtools, same check as the tab-bar plan's icon task.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(icons): vendor taste-range and utensils icons for the solids feature"
```

---

### Task 3: Food catalog module

**Files:**
- Create: `js/foods.js`
- Test: `js/store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `FOOD_CATALOG` — an exported array of `{ key, label, group, icon }` objects (`icon` is a filename stem under `assets/foods/`, e.g. `'banana'` → `assets/foods/banana.webp`; the actual asset files are generated in Task 11 — this module only defines the catalog data, and the food picker in Task 5 tolerates a missing asset file by falling back to the utensils sprite icon, same as a custom "Other" food). Also produces `findFoodByKey(key)` and a helper `groupedCatalog()` that returns the catalog pre-grouped by `group` for rendering.

- [ ] **Step 1: Write the catalog**

```js
// foods.js: curated first-foods catalog for the Solids feature.
// `icon` is a filename stem under assets/foods/<icon>.webp — see Task 11
// for how those assets are generated. A missing file falls back to the
// generic utensils icon at render time (js/solids-form.js), so this list
// can grow ahead of icon generation without breaking anything.
export const FOOD_CATALOG = [
  // Fruits
  { key: 'banana', label: 'Banana', group: 'Fruits', icon: 'banana' },
  { key: 'apple', label: 'Apple', group: 'Fruits', icon: 'apple' },
  { key: 'pear', label: 'Pear', group: 'Fruits', icon: 'pear' },
  { key: 'avocado', label: 'Avocado', group: 'Fruits', icon: 'avocado' },
  { key: 'blueberry', label: 'Blueberry', group: 'Fruits', icon: 'blueberry' },
  { key: 'strawberry', label: 'Strawberry', group: 'Fruits', icon: 'strawberry' },
  { key: 'mango', label: 'Mango', group: 'Fruits', icon: 'mango' },
  { key: 'peach', label: 'Peach', group: 'Fruits', icon: 'peach' },
  // Vegetables
  { key: 'sweet-potato', label: 'Sweet potato', group: 'Vegetables', icon: 'sweet-potato' },
  { key: 'carrot', label: 'Carrot', group: 'Vegetables', icon: 'carrot' },
  { key: 'broccoli', label: 'Broccoli', group: 'Vegetables', icon: 'broccoli' },
  { key: 'peas', label: 'Peas', group: 'Vegetables', icon: 'peas' },
  { key: 'green-beans', label: 'Green beans', group: 'Vegetables', icon: 'green-beans' },
  { key: 'zucchini', label: 'Zucchini', group: 'Vegetables', icon: 'zucchini' },
  { key: 'spinach', label: 'Spinach', group: 'Vegetables', icon: 'spinach' },
  { key: 'butternut-squash', label: 'Butternut squash', group: 'Vegetables', icon: 'butternut-squash' },
  // Grains / starches
  { key: 'oatmeal', label: 'Oatmeal', group: 'Grains & starches', icon: 'oatmeal' },
  { key: 'rice-cereal', label: 'Rice cereal', group: 'Grains & starches', icon: 'rice-cereal' },
  { key: 'bread', label: 'Bread', group: 'Grains & starches', icon: 'bread' },
  { key: 'pasta', label: 'Pasta', group: 'Grains & starches', icon: 'pasta' },
  // Proteins
  { key: 'chicken', label: 'Chicken', group: 'Proteins', icon: 'chicken' },
  { key: 'beef', label: 'Beef', group: 'Proteins', icon: 'beef' },
  { key: 'lentils', label: 'Lentils', group: 'Proteins', icon: 'lentils' },
  { key: 'tofu', label: 'Tofu', group: 'Proteins', icon: 'tofu' },
  { key: 'yogurt', label: 'Yogurt', group: 'Proteins', icon: 'yogurt' },
  // Common allergens
  { key: 'peanut-butter', label: 'Peanut butter', group: 'Common allergens', icon: 'peanut-butter' },
  { key: 'egg', label: 'Egg', group: 'Common allergens', icon: 'egg' },
  { key: 'cheese', label: 'Cheese (dairy)', group: 'Common allergens', icon: 'cheese' },
  { key: 'almond', label: 'Almond (tree nut)', group: 'Common allergens', icon: 'almond' },
  { key: 'wheat', label: 'Wheat', group: 'Common allergens', icon: 'wheat' },
  { key: 'soy', label: 'Soy', group: 'Common allergens', icon: 'soy' },
  { key: 'shrimp', label: 'Shrimp (shellfish)', group: 'Common allergens', icon: 'shrimp' },
  { key: 'sesame', label: 'Sesame', group: 'Common allergens', icon: 'sesame' },
];

export function findFoodByKey(key) {
  return FOOD_CATALOG.find((f) => f.key === key) || null;
}

export function groupedCatalog() {
  const groups = new Map();
  for (const f of FOOD_CATALOG) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
```

- [ ] **Step 2: Write a test**

```js
import { FOOD_CATALOG, findFoodByKey, groupedCatalog } from './foods.js';

test('food catalog has unique keys', () => {
  const keys = FOOD_CATALOG.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('findFoodByKey finds a known food and returns null for an unknown one', () => {
  assert.equal(findFoodByKey('banana').label, 'Banana');
  assert.equal(findFoodByKey('not-a-real-food'), null);
});

test('groupedCatalog groups every catalog entry under its group', () => {
  const groups = groupedCatalog();
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  assert.equal(total, FOOD_CATALOG.length);
});
```

- [ ] **Step 3: Run the tests**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/foods.js js/store.test.js
git commit -m "feat(solid): add the curated first-foods catalog"
```

---

### Task 4: Extend `iconGrid()` to render food icons as images

**Files:**
- Modify: `js/sheets.js` (`iconGrid()`, ~line 20-24)

**Interfaces:**
- Consumes: nothing new.
- Produces: `iconGrid(group, opts, sel)` now accepts an optional `img` field per option (`{ val, img, label }`, alongside the existing `{ val, icon, label }` sprite form) — renders `<img>` when `img` is set, falls back to the existing `<use>` sprite rendering otherwise. Existing callers (the sleep-method grid at `sheets.js:487`) are unaffected since none of their options set `img`.

- [ ] **Step 1: Write a failing test**

`iconGrid()` returns an HTML string, so this is a string-shape test rather than a DOM test — add to `js/store.test.js` (or wherever other `sheets.js` string-template exports are already tested, if that pattern exists; check first):

```js
import { iconGrid } from './sheets.js';

test('iconGrid renders an img tag when an option has an img field', () => {
  const html = iconGrid('food-0', [{ val: 'banana', img: 'assets/foods/banana.webp', label: 'Banana' }], null);
  assert.ok(html.includes('<img src="assets/foods/banana.webp"'), html);
});

test('iconGrid still renders a sprite use tag when an option has no img field', () => {
  const html = iconGrid('method', [{ val: 'On own in bed', icon: 'bed-single', label: 'On own' }], null);
  assert.ok(html.includes('<use href="#bed-single">'), html);
});
```

(If `iconGrid` isn't currently exported from `sheets.js` in a way the test file can import standalone — check the existing `export function iconGrid` at `sheets.js:20`, it already is — this should import cleanly.)

- [ ] **Step 2: Run the test to verify the first assertion fails**

Run: `node --test js/store.test.js`
Expected: FAIL on the first new test (`iconGrid` has no `img` branch yet)

- [ ] **Step 3: Extend `iconGrid()`**

Current:

```js
export function iconGrid(group, opts, sel) {
  return `<div class="icongrid" data-icongrid="${group}">` +
    opts.map((o) => `<button type="button" class="icongrid-opt ${o.val === sel ? 'on' : ''}" data-val="${esc(o.val)}" data-action="icongrid:pick">` +
      `<svg class="icon"><use href="#${esc(o.icon)}"></use></svg><span>${esc(o.label)}</span></button>`).join('') +
    `</div>`;
}
```

Change to:

```js
export function iconGrid(group, opts, sel) {
  return `<div class="icongrid" data-icongrid="${group}">` +
    opts.map((o) => `<button type="button" class="icongrid-opt ${o.val === sel ? 'on' : ''}" data-val="${esc(o.val)}" data-action="icongrid:pick">` +
      (o.img ? `<img src="${esc(o.img)}" alt="" class="icongrid-img" onerror="this.outerHTML='&lt;svg class=&quot;icon&quot;&gt;&lt;use href=&quot;#utensils&quot;&gt;&lt;/use&gt;&lt;/svg&gt;'">`
             : `<svg class="icon"><use href="#${esc(o.icon)}"></use></svg>`) +
      `<span>${esc(o.label)}</span></button>`).join('') +
    `</div>`;
}
```

The inline `onerror` handler is the missing-icon-asset fallback described in Task 3 — if a catalog entry's `.webp` file doesn't exist yet (icon generation hasn't shipped for that food), the tile swaps to the utensils sprite icon instead of showing a broken image, so the food picker never looks broken regardless of icon-generation progress. The replacement markup is written with HTML entities (`&lt;`/`&quot;`) rather than raw `<`/`"`/nested `'` characters — the browser's attribute parser decodes those entities into the real markup before the JS ever runs, so this sidesteps the quote-nesting bugs that an inline mix of single and double quotes inside an `onerror="..."` attribute is prone to (the original draft mixed both and would have broken the attribute's own delimiters).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/sheets.js js/store.test.js
git commit -m "feat(solid): extend iconGrid to render food images with a sprite fallback"
```

---

### Task 5: Row-scoped multi-food form machinery

Note on scope: this task (module + action handlers + a DOM test whose exact home is decided at implementation time) and Task 6 (form template + gather/prefill wiring + the end-to-end Playwright spec) could each be split further into a pure-logic sub-task and a DOM/event-wiring sub-task. Left combined here because neither task's pieces are independently shippable or reviewable on their own — `renderFoodRow`/`gatherFoodRows` have no caller until the action handlers and form template exist, and a reviewer evaluating "does the row machinery work" needs to see it wired end-to-end to judge it, not just the module in isolation. Splitting would add two more subagent review gates for no corresponding gain in reviewability.

**Files:**
- Create: `js/solids-form.js`
- Modify: `js/app.js` (two new action handlers: `solids:add-row`, `solids:remove-row`)
- Test: `js/store.test.js`

**Interfaces:**
- Consumes: `iconGrid`, `seg`, `field` (all exported or made exportable from `js/sheets.js` — `seg`/`field` are currently module-private; this task exports them, see Step 1), `FOOD_CATALOG`/`groupedCatalog` from `js/foods.js`.
- Produces: `renderFoodRow(rowId, prefillRow)` — returns an HTML string for one food row (`prefillRow` optional, used when editing an existing entry). `gatherFoodRows()` — reads every currently-rendered row from the DOM and returns a `foods` array matching the Data shape in the spec. `prefillFoodRows(foods)` — given an entry's `foods` array, replaces the sheet's row container content with one rendered+prefilled row per array element (used by `sheets.js`'s `prefill()` for editing). Later tasks (Task 6) call all three from `sheets.js`.

- [ ] **Step 1: Move `seg`, `field`, and `iconGrid` from `sheets.js` to `ui.js`, exported from there**

`js/solids-form.js` (written in Step 2 below) needs `seg`/`field`/`iconGrid`, and `js/sheets.js` needs to import `renderFoodRow`/`gatherFoodRows`/`prefillFoodRows` back from `solids-form.js` in Task 6. Simply adding `export` to `seg`/`field` in place (leaving them defined in `sheets.js`) would create a circular import: `sheets.js → solids-form.js → sheets.js`. ES modules tolerate some circular imports, but not reliably when the imported bindings are consumed at module-evaluation time (as `FORMS` object literals are) rather than only inside function bodies — don't rely on it working.

Avoid the cycle by relocating `seg`, `field`, and `iconGrid` to `js/ui.js`, which has no dependency on `sheets.js` today (confirm this with `rg "from './sheets.js'" js/ui.js` before proceeding — it should return nothing):

1. Cut the full function bodies of `seg` (`sheets.js:9`), `field` (`sheets.js:26`), and `iconGrid` (`sheets.js:20-24`, already modified by Task 4) out of `js/sheets.js` and paste them into `js/ui.js`, each with `export` added:

```js
export function seg(group, opts, sel) { ... }
export function field(label, inner) { ... }
export function iconGrid(group, opts, sel) { ... }
```

(Keep their bodies exactly as they are in `sheets.js` today, plus Task 4's `img`-fallback change to `iconGrid` — this step only moves *where* the functions live, it doesn't change their logic.)

2. In `js/sheets.js`, add `seg`, `field`, and `iconGrid` to the existing `import { ... } from './ui.js'` line at the top of the file, and delete the old local definitions.

3. Run `node --test js/store.test.js` and confirm nothing broke — `sheets.js`'s own callers of `seg`/`field`/`iconGrid` are unaffected since the import gives them the same names in the same module scope.

- [ ] **Step 2: Write `js/solids-form.js`**

```js
// solids-form.js: row-scoped multi-food UI for the solids log form.
// Existing per-type-global helpers (seg/segVal/setSeg, iconGrid/setIconGrid)
// already scope by an arbitrary group-name string, so giving each food row
// a unique, row-id-suffixed group name lets them work unmodified here --
// this module is the row-aware wrapper around them, not a replacement.
import { $, $$, esc, seg, field, iconGrid } from './ui.js';
import { groupedCatalog, findFoodByKey } from './foods.js';

const AMOUNT_OPTS = ['None', 'Little', 'Some', 'Most', 'All'];
const REACTION_OPTS = [
  { val: 'hates', icon: 'frown', label: 'Hates it' },
  { val: 'unsure', icon: 'meh', label: 'Unsure' },
  { val: 'likes', icon: 'smile', label: 'Likes it' },
  { val: 'loves', icon: 'laugh', label: 'Loves it' },
];

function foodPickerOptions() {
  const opts = [];
  for (const { items } of groupedCatalog()) {
    for (const f of items) opts.push({ val: f.key, img: `assets/foods/${f.icon}.webp`, label: f.label });
  }
  opts.push({ val: '__other__', icon: 'utensils', label: 'Other' });
  return opts;
}

// Renders one food row. `prefillRow` (optional) is one element of an
// entry's `foods` array, used when editing an existing solids entry.
export function renderFoodRow(rowId, prefillRow) {
  const selectedFoodVal = prefillRow ? (prefillRow.key || '__other__') : null;
  const isCustom = !!(prefillRow && !prefillRow.key);
  const amountSel = prefillRow && prefillRow.amount ? prefillRow.amount : null;
  const isAmountCustom = !!(prefillRow && prefillRow.amountCustom);
  const reactionSel = prefillRow ? prefillRow.reaction : null;
  const allergyOn = !!(prefillRow && prefillRow.allergy);
  const customLabel = prefillRow && !prefillRow.key ? prefillRow.label : '';

  return `<div class="food-row" data-food-row="${rowId}">
    ${field('Food', iconGrid(`food-${rowId}`, foodPickerOptions(), selectedFoodVal))}
    <div class="food-custom-name" id="food-custom-${rowId}" ${isCustom ? '' : 'hidden'}>
      ${field('Food name', `<input type="text" id="f-food-custom-${rowId}" value="${esc(customLabel)}" placeholder="Type a food name" />`)}
    </div>
    ${field('Amount', seg(`amount-${rowId}`, AMOUNT_OPTS, isAmountCustom ? null : (amountSel || 'Some')))}
    <div class="food-amount-custom" id="amount-custom-${rowId}" ${isAmountCustom ? '' : 'hidden'}>
      ${field('Custom amount', `<input type="text" id="f-amount-custom-${rowId}" value="${esc(prefillRow && prefillRow.amountCustom || '')}" placeholder="e.g. 2 tbsp" />`)}
    </div>
    <button type="button" class="btn-ghost food-amount-toggle" data-action="foodrow:toggle-amount" data-row="${rowId}">Use custom amount instead</button>
    ${field('Reaction', iconGrid(`reaction-${rowId}`, REACTION_OPTS, reactionSel))}
    ${field('Allergy or sensitivity', `<button type="button" class="switch ${allergyOn ? 'on' : ''}" id="f-allergy-${rowId}" role="switch" aria-checked="${allergyOn}" data-action="form:toggle"><span class="knob"></span></button>`)}
    <button type="button" class="btn-ghost food-row-remove" data-action="solids:remove-row" data-row="${rowId}">Remove this food</button>
  </div>`;
}

// Reads every rendered row from the DOM and builds the entry's `foods`
// array. Called by sheets.js's gather() for type 'solid'.
export function gatherFoodRows() {
  const rows = $$('[data-food-row]');
  return [...rows].map((rowEl) => {
    const rowId = rowEl.dataset.foodRow;
    const foodSel = $(`[data-icongrid="food-${rowId}"] .icongrid-opt.on`);
    const foodVal = foodSel ? foodSel.dataset.val : null;
    const isCustom = foodVal === '__other__';
    const customInput = $(`#f-food-custom-${rowId}`);
    const key = isCustom ? null : foodVal;
    // For a catalog pick, store the catalog's display label ('Banana'), not
    // the raw catalog key ('banana') -- gatherFoodRows previously stored the
    // key itself here, which meant every non-custom row rendered its saved
    // label as the lowercase key instead of the proper display text.
    const catalogFood = !isCustom && foodVal ? findFoodByKey(foodVal) : null;
    const label = isCustom ? (customInput ? customInput.value.trim() : '') : (catalogFood ? catalogFood.label : (foodVal || ''));

    const amountCustomInput = $(`#f-amount-custom-${rowId}`);
    const amountCustomEl = $(`#amount-custom-${rowId}`);
    const amountCustomVisible = !!amountCustomEl && !amountCustomEl.hidden;
    const amountSel = $(`[data-seg="amount-${rowId}"] .seg-opt.on`);

    const reactionSel = $(`[data-icongrid="reaction-${rowId}"] .icongrid-opt.on`);
    const allergyEl = $(`#f-allergy-${rowId}`);

    return {
      key,
      label,
      amount: amountCustomVisible ? null : (amountSel ? amountSel.dataset.val : null),
      amountCustom: amountCustomVisible ? (amountCustomInput ? amountCustomInput.value.trim() : '') : null,
      reaction: reactionSel ? reactionSel.dataset.val : null,
      allergy: allergyEl ? allergyEl.classList.contains('on') : false,
    };
  }).filter((row) => row.key || row.label); // drop a row nobody picked a food for
}

// Replaces the row container's content with one row per element of an
// existing entry's `foods` array. Called by sheets.js's prefill() when
// editing a solid entry.
export function prefillFoodRows(foods) {
  const container = $('#food-rows');
  if (!container) return;
  const rows = foods && foods.length ? foods : [null]; // always show at least one row
  container.innerHTML = rows.map((row, i) => renderFoodRow(i, row)).join('');
}

export function nextFoodRowId() {
  const rows = $$('[data-food-row]');
  if (!rows.length) return 0;
  return Math.max(...[...rows].map((r) => Number(r.dataset.foodRow))) + 1;
}
```

- [ ] **Step 3: Add the `solids:add-row`/`solids:remove-row`/`foodrow:toggle-amount` action handlers**

In `js/app.js`, find the action-handler map's `'icongrid:pick'` entry (~line 314) and add three new entries near it, plus the import at the top of the file:

```js
import { renderFoodRow, nextFoodRowId } from './solids-form.js';
```

```js
    'solids:add-row': () => {
      const container = $('#food-rows');
      if (!container) return;
      container.insertAdjacentHTML('beforeend', renderFoodRow(nextFoodRowId(), null));
      initThumbs(container);
    },
    'solids:remove-row': () => {
      const rowEl = el.closest('[data-food-row]');
      const container = $('#food-rows');
      if (!rowEl || !container) return;
      // Always keep at least one row visible.
      if ($$('[data-food-row]', container).length > 1) rowEl.remove();
    },
    'foodrow:toggle-amount': () => {
      const rowId = d.row;
      const segEl = $(`[data-seg="amount-${rowId}"]`);
      const customEl = $(`#amount-custom-${rowId}`);
      if (!segEl || !customEl) return;
      const showingCustom = !customEl.hidden;
      customEl.hidden = showingCustom;
      segEl.closest('.fld').hidden = !showingCustom;
      el.textContent = showingCustom ? 'Use custom amount instead' : 'Use the amount scale instead';
    },
```

(`initThumbs` is already imported in `app.js` per its existing import line — it re-binds the drag-thumb behavior for any new `.segctl` elements a freshly-inserted row brings in, same as `router.go` already does for a whole view.)

- [ ] **Step 4: Write a unit test for `gatherFoodRows()`/`prefillFoodRows()` against a minimal DOM fixture**

Check how other DOM-dependent tests in `js/store.test.js` set up a fake DOM (search the file for any existing pattern — e.g. a lightweight `document`/`window` shim, or whether these tests run under a real browser via Playwright instead of `node --test`). If `store.test.js` has no DOM available, this test belongs in a new Playwright spec instead — write it there:

```js
// tests/solids-form.test.js — Playwright, DOM-dependent
// (follow this repo's existing Playwright spec structure/imports; check
// an existing small spec like tests/diaper-mixed-size.test.js for the
// harness setup — page launch, app load, helper functions like `check()`.)
```

Add a test that: opens the solids log sheet, picks a food for row 0 via the food-picker tile, sets an amount, sets a reaction, adds a second row via "Add another food," picks a different food, sets its own amount/reaction/allergy independently, saves, and asserts the saved entry's `foods` array has 2 elements with the expected per-row values, confirming allergy on one row doesn't leak onto the other. (This overlaps with Task 6's own save-flow test — write it once, in whichever file ends up owning the full solids-logging Playwright spec; don't duplicate.)

- [ ] **Step 5: Commit**

```bash
git add js/solids-form.js js/app.js js/sheets.js
git commit -m "feat(solid): add row-scoped multi-food form machinery"
```

---

### Task 6: The `solid` form template, `gather()`, and `prefill()` wiring

**Files:**
- Modify: `js/sheets.js` (`FORMS` object, `gather()`, `prefill()`)

**Interfaces:**
- Consumes: `renderFoodRow`, `gatherFoodRows`, `prefillFoodRows` from `js/solids-form.js` (Task 5).
- Produces: a working `solid` entry type end-to-end through the existing log-sheet flow (`openLog('solid')` → fill form → `saveLog('solid')`).

- [ ] **Step 1: Add the `solid` form template**

In `js/sheets.js`, add an import at the top:

```js
import { renderFoodRow, gatherFoodRows, prefillFoodRows } from './solids-form.js';
```

Add a `solid` entry to the `FORMS` object (after `diaper`, before `medicine`, matching the ordering used elsewhere in this plan):

```js
  solid: () => `
    <div id="food-rows">${renderFoodRow(0, null)}</div>
    <button type="button" class="btn-ghost" data-action="solids:add-row">+ Add another food</button>
    ${timeRow()} ${noteRow()}`,
```

- [ ] **Step 2: Wire `gather()` for `type === 'solid'`**

In `gather(type)`, find the `else if (type === 'diaper') { ... }` block and add a new branch after it:

```js
  } else if (type === 'solid') {
    base.foods = gatherFoodRows();
```

- [ ] **Step 3: Wire `prefill()` for `type === 'solid'`**

In `prefill(type, e)`, find the `else if (type === 'diaper') { ... }` block and add a new branch after it:

```js
  } else if (type === 'solid') {
    prefillFoodRows(e.foods);
  }
```

- [ ] **Step 4: Write the end-to-end Playwright spec (or extend the one started in Task 5)**

Create `tests/solids-logging.test.js` (or finish the one started in Task 5, Step 4, if that's where it landed — one file, not two). Follow the structure of an existing small spec (`tests/diaper-mixed-size.test.js` is a good template: launch, load app, `check()` helper, `page.evaluate` to read saved state). Cover:

- Opening the log-type chooser shows a "Solids" tile.
- Logging one food: pick a food tile, set amount via the segmented control, set reaction via the taste-range grid, save; assert the saved entry has `type: 'solid'`, `foods: [{ key: '<picked food>', amount: '<picked amount>', reaction: '<picked reaction>', allergy: false, ... }]`, and `start` is set (not `time`).
- Logging two foods: add a second row, pick a different food and a different reaction/allergy combination for it, save; assert `foods.length === 2` and the two rows' `allergy` values are independent (one `true`, one `false`).
- Custom food: pick the "Other" tile, type a custom name, save; assert the saved row has `key: null` and `label: '<typed text>'`.
- Custom amount: toggle "Use custom amount instead," type a value, save; assert `amount: null` and `amountCustom: '<typed text>'`.
- Editing: open an existing 2-food solids entry for edit, assert both rows render prefilled with their original values (this exercises `prefillFoodRows`).

- [ ] **Step 5: Run the new spec**

Run: `CHROMIUM=/usr/bin/chromium node tests/run.js` scoped to the new file (check `tests/run.js --help` or `package.json` for the exact single-file invocation), with `CONCURRENCY=1` (the project default — never override it).
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/sheets.js tests/solids-logging.test.js
git commit -m "feat(solid): wire the solids log form into gather/prefill"
```

---

### Task 7: `normalizeSolidFoods` — sanitize on both the localStorage-load and sync-ingress paths

**Files:**
- Modify: `js/store.js` (`normalizeLog`, `applySyncResponse`)
- Test: `js/store.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeSolidFoods(foods)` — an exported function from `js/store.js` (or kept module-private and only exercised indirectly via `normalizeLog`/`applySyncResponse`, tested through those two entry points — export it directly if the test file's existing style favors testing small helpers directly; check the file's convention first).

- [ ] **Step 1: Write the failing tests**

```js
test('normalizeLog defaults foods to [] for a solid entry missing the field', () => {
  const log = [{ id: '1', type: 'solid', start: '2026-08-15T10:00:00Z' }];
  const result = normalizeLog(log);
  assert.deepEqual(result[0].foods, []);
});

test('normalizeLog drops a malformed food row missing both key and label', () => {
  const log = [{ id: '1', type: 'solid', start: '2026-08-15T10:00:00Z', foods: [
    { key: 'banana', label: 'Banana', amount: 'Some', reaction: 'likes', allergy: false },
    { amount: 'Some', reaction: 'likes', allergy: false }, // no key, no label -- unrecoverable
  ] }];
  const result = normalizeLog(log);
  assert.equal(result[0].foods.length, 1);
  assert.equal(result[0].foods[0].key, 'banana');
});

test('applySyncResponse sanitizes foods on incoming solid entries the same way normalizeLog does', () => {
  resetStoreForTest(); // use whatever existing test-reset helper this file already provides -- check its name before assuming this one
  const resp = { entries: [{ id: 'sync-1', type: 'solid', start: '2026-08-15T10:00:00Z', foods: [
    { amount: 'Some' }, // malformed: no key, no label
  ] }] };
  applySyncResponse(resp, { ids: new Set(), baby: false, settings: false });
  const saved = state().log.find((e) => e.id === 'sync-1');
  assert.deepEqual(saved.foods, []);
});
```

(The exact test-setup helper name for resetting store state between tests — `resetStoreForTest()` above is a placeholder for whatever this file's existing tests actually call; read a nearby existing test in `store.test.js` that already exercises `applySyncResponse` or `state()` to copy its real setup pattern before writing this one.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test js/store.test.js`
Expected: FAIL — `normalizeLog` doesn't touch `foods` at all yet, and `applySyncResponse` doesn't sanitize `foods` either.

- [ ] **Step 3: Add `normalizeSolidFoods` and wire it into both paths**

In `js/store.js`, add near `normalizeLog`:

```js
// Sanitizes an entry's `foods` array on both the localStorage-load path
// (normalizeLog) and the sync-ingress path (applySyncResponse) -- any
// future entry field that can arrive from sync needs the same
// default/sanitize step applied on both paths, not just normalizeLog.
function normalizeSolidFoods(foods) {
  if (!Array.isArray(foods)) return [];
  return foods.filter((row) => row && (row.key || row.label));
}
```

Change `normalizeLog` to call it:

```js
export function normalizeLog(log) {
  if (!Array.isArray(log)) return [];
  return log.map((e) => {
    if (e && e.type === 'sleep' && e.end && new Date(e.end) < new Date(e.start)) {
      return { ...e, start: e.end, end: e.start };
    }
    if (e && e.type === 'diaper' && e.kind === 'Mixed' && e.size && e.wetSize == null && e.dirtySize == null) {
      return { ...e, wetSize: e.size, dirtySize: e.size };
    }
    if (e && e.type === 'solid') {
      return { ...e, foods: normalizeSolidFoods(e.foods) };
    }
    return e;
  });
}
```

Change `applySyncResponse` to sanitize incoming solid entries before merge:

```js
export function applySyncResponse(resp, pending = pendingSyncState()) {
  if (resp.baby && !pending.baby) Object.assign(_state.baby, resp.baby);
  if (resp.settings && !pending.settings) { Object.assign(_state.settings, resp.settings); normalizeSettings(_state.settings); }
  const incomingEntries = (resp.entries || [])
    .filter((e) => !pending.ids.has(e.id))
    .map((e) => (e.type === 'solid' ? { ...e, foods: normalizeSolidFoods(e.foods) } : e));
  _state.log = mergeById(_state.log, incomingEntries);
  _state.log.sort((a, b) => b.start < a.start ? -1 : b.start > a.start ? 1 : 0);
  _state.growth = mergeById(_state.growth, (resp.growth || []).filter((g) => !pending.ids.has(g.id)));
  if (resp.currentCaregiverId) _state.currentCaregiverId = resp.currentCaregiverId;
  _state.caregivers = mergeById(_state.caregivers || [], resp.caregivers || []);
  save();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "fix(solid): sanitize foods on both the load and sync-ingress paths"
```

---

### Task 8: Solids Home card (no reminder-interval wiring)

**Files:**
- Modify: `js/home.js` (`CARD_RENDER`, a new `solidCard()` function)
- Modify: `styles.css` (a `.tone-solid` rule, alongside the existing `tone-diaper`/etc. rules)

**Interfaces:**
- Consumes: `summary()` (already updated implicitly — no change needed, `summary()`'s generic fallback via `TYPES[e.type]` already produces a reasonable label for `solid` once Task 1 registers it, though the Home card itself renders its own markup rather than going through `summary()`, matching how `bottleCard`/`medicineCard` already work).
- Produces: `solidCard()`, wired into `CARD_RENDER` so `cardHTML('solid')` renders it instead of falling through to `genericCard('solid')`.

- [ ] **Step 1: Add `solidCard()`**

In `js/home.js`, add a new function near the other card renderers (`bottleCard`, `medicineCard`, `hygieneCard`) — read one of those (e.g. `hygieneCard`, ~line 339) first to match its exact markup structure (the `.info-card`, `.ic-ring`, `.ic-txt` classes, the `icEdit()` call for the edit-mode gear/remove affordance), then write:

```js
// Solids has no reminder-interval scheduling (unlike bottle/medicine), so
// it gets its own render function instead of going through genericCard(),
// which assumes every card type has an interval to count down to.
function solidCard() {
  const items = state().log.filter((e) => e.type === 'solid');
  const last = items.length ? items[0] : null; // log is sorted newest-first by start
  const lbl = last ? `Last meal · ${fmt.untilOrAgo(new Date(last.start))}` : 'No solids logged yet';
  const foodCount = last && last.foods ? last.foods.length : 0;
  const sub = last && foodCount ? `${foodCount} food${foodCount === 1 ? '' : 's'}` : '';
  return `<div class="info-card" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="solid" data-card="solid">
    <div class="ic-ring tone-solid"><svg class="icon"><use href="#utensils"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">${lbl}</div>
      <div class="ic-val">${sub}</div>
    </div>
    <a class="ic-link" data-action="nav:foods-tried">Foods tried</a>
    ${icEdit('solid')}
  </div>`;
}
```

Add it to `CARD_RENDER`:

```js
const CARD_RENDER = { bottle: bottleCard, medicine: medicineCard, bath: bathCard, hygiene: hygieneCard, solid: solidCard };
```

(The `nav:foods-tried` action is wired in Task 10, which is fine to land after this task — the link just won't navigate anywhere until then; don't block this task on Task 10.)

- [ ] **Step 2: Add `.tone-solid` CSS**

In `styles.css`, find the existing `tone-diaper`/`tone-feed`/etc. rules (grep for `tone-diaper` to find them) and add a matching `.tone-solid` rule using a color distinct from the other tones — check the file's existing color-variable naming convention (e.g. CSS custom properties like `--tone-diaper`) and follow it rather than hardcoding a new hex value inline.

- [ ] **Step 3: Manual check**

Load the app locally, use the card picker to add the Solids card to Home, confirm it renders with the utensils icon and "No solids logged yet," then log a solids entry and confirm the card updates to show the last-meal time and food count.

- [ ] **Step 4: Commit**

```bash
git add js/home.js styles.css
git commit -m "feat(solid): add the Solids Home card"
```

---

### Task 9: Foods-tried rollup view

**Files:**
- Create: `js/foods-tried.js`
- Modify: `js/app.js` (import, `VIEWS`, a new `nav:foods-tried` action handler)

**Interfaces:**
- Consumes: `state()` from `js/store.js`, `findFoodByKey` from `js/foods.js`.
- Produces: `foodsTried()` — an exported render function, no args, same shape as `timeline()`/`growth()` (returns an HTML string, reached via `router.go('foods-tried')`, not part of `TABS`).

- [ ] **Step 1: Write `js/foods-tried.js`**

```js
// foods-tried.js: rollup view of every distinct food ever logged, derived
// entirely from existing solid log entries -- no separate food-library
// table. Reached from the Solids Home card, not a bottom tab -- same
// "non-tab view with a back-to-Home button" pattern timeline.js used
// before it was promoted to a tab.
import { state } from './store.js';
import { esc, fmt } from './ui.js';
import { findFoodByKey } from './foods.js';

const REACTION_LABELS = { hates: 'Hates it', unsure: 'Unsure', likes: 'Likes it', loves: 'Loves it' };

function rollupRows() {
  const byIdentity = new Map(); // groups by catalog key, or lowercase custom label
  for (const e of state().log) {
    if (e.type !== 'solid' || !e.foods) continue;
    for (const row of e.foods) {
      const identity = row.key || (row.label || '').toLowerCase();
      if (!identity) continue;
      const catalogFood = row.key ? findFoodByKey(row.key) : null;
      const displayLabel = catalogFood ? catalogFood.label : (row.label || row.key);
      const icon = catalogFood ? catalogFood.icon : null;
      const existing = byIdentity.get(identity);
      const tried = { start: e.start, reaction: row.reaction, allergy: !!row.allergy };
      if (!existing) {
        byIdentity.set(identity, { identity, label: displayLabel, icon, timesTried: 1, lastTried: tried.start, latestReaction: tried.reaction, everAllergy: tried.allergy });
      } else {
        existing.timesTried += 1;
        existing.everAllergy = existing.everAllergy || tried.allergy;
        if (new Date(tried.start) > new Date(existing.lastTried)) {
          existing.lastTried = tried.start;
          existing.latestReaction = tried.reaction;
        }
      }
    }
  }
  return [...byIdentity.values()];
}

export function foodsTried() {
  const rows = rollupRows().sort((a, b) => (b.everAllergy - a.everAllergy) || new Date(b.lastTried) - new Date(a.lastTried));
  return `<div class="page-hd">
      <button class="tl-back" data-action="nav:home" aria-label="Back to Home"><svg class="icon"><use href="#chevron-left"></use></svg></button>
      <h1 class="page-title">Foods tried</h1>
    </div>
    <div class="card log">
      ${rows.length ? rows.map((r) => `<div class="log-row">
        <span class="tok tone-solid"><svg class="icon"><use href="#${r.icon ? 'utensils' : 'utensils'}"></use></svg></span>
        <span class="row-txt"><span class="what">${esc(r.label)}${r.everAllergy ? ' ⚠' : ''}</span>
        <span class="when">${r.timesTried}× · last ${fmt.untilOrAgo(new Date(r.lastTried))} · ${esc(REACTION_LABELS[r.latestReaction] || '')}</span></span>
      </div>`).join('') : `<div class="empty-log">No foods logged yet.</div>`}
    </div>`;
}
```

Note: this initial pass renders every row with the generic `utensils` sprite icon rather than the per-food `<img>` (the food picker's icons need the `iconGrid` `img` extension from Task 4, but this list view uses a plain `<img>`/sprite row layout, not `iconGrid` — if the per-food icon is wanted here too, swap the `<use href="#utensils">` for `<img src="assets/foods/${r.icon}.webp" onerror="...">` matching Task 4's fallback pattern; left as `utensils` for all rows here since the spec doesn't require per-row icons in the rollup, only "food icon, name, latest reaction, times tried, last-tried date, allergy flag" — implementation-time call, revisit if it looks sparse in review).

- [ ] **Step 2: Wire it into `app.js`**

Add the import:

```js
import { foodsTried } from './foods-tried.js';
```

Add to `VIEWS` (this is a non-tab view — `VIEWS` isn't limited to tab-bar entries, `timeline` itself worked this way before this batch's tab-bar restructure promoted it):

```js
const VIEWS = { home, sleep, insights, profile, timeline, 'foods-tried': foodsTried };
```

Add the nav action:

```js
    'nav:foods-tried': () => router.go('foods-tried'),
```

- [ ] **Step 3: Write a unit test for the rollup grouping logic**

Since `rollupRows()` isn't exported (it's a private helper), either export it for direct testing or test through `foodsTried()`'s output string — check the file's/project's existing convention for testing render functions (e.g. does `js/store.test.js` test any `home.js`/`growth.js` render function's output string directly?) before choosing. A reasonable test regardless of approach:

```js
test('foods-tried rollup groups repeated foods and keeps the latest reaction', () => {
  // Seed state().log with two solid entries logging the same catalog food
  // ('banana') at different times with different reactions, using
  // whatever this file's existing pattern is for seeding state().log in a
  // test (check an existing test that reads state().log after inserting
  // entries, e.g. one of the diaper or sleep tests, for the real setup call).
  // Assert the rollup shows one banana row with timesTried === 2 and
  // latestReaction matching the later entry's reaction, not the earlier one.
});
```

- [ ] **Step 4: Manual check**

Log two solids entries with an overlapping food (e.g. banana twice, with different reactions), navigate to the Solids card's "Foods tried" link, confirm one row shows for banana with `2×` and the later reaction.

- [ ] **Step 5: Commit**

```bash
git add js/foods-tried.js js/app.js js/store.test.js
git commit -m "feat(solid): add the foods-tried rollup view"
```

---

### Task 10: Batch-generate food icon assets via fal.ai, add to the service-worker precache safely

**Files:**
- Create: `assets/foods/*.webp` (one per `FOOD_CATALOG` entry — 30 files per the Task 3 catalog)
- Modify: `sw.js` (the `cache.addAll([...])` precache manifest, ~lines 42-46)

**Interfaces:**
- Consumes: `FOOD_CATALOG` from `js/foods.js` (Task 3) as the authoritative list of required filenames.
- Produces: static asset files at `assets/foods/<icon>.webp` matching every `icon` field in the catalog; an updated `sw.js` precache list.

- [ ] **Step 1: Generate the icons**

Batch-generate one icon per `FOOD_CATALOG` entry via the `fal.ai` API, in the app's existing hand-illustrated visual style — match the tone of `assets/sky/*.webp` (open a couple of those files to see the actual art style/palette before writing prompts). This needs a `FAL_KEY` (or equivalent) credential — check the project's existing secrets-handling convention (env var, not committed) before running. Write a small one-off generation script (not committed to the repo unless the project already has a precedent for keeping such scripts — check for one first, e.g. under a `scripts/` directory) that loops over `FOOD_CATALOG`, builds a per-food prompt from its `label`, calls fal.ai, and saves the result to `assets/foods/<icon>.webp`.

- [ ] **Step 2: Verify every catalog icon file exists and loads**

```bash
node -e "
const { FOOD_CATALOG } = require('./js/foods.js');
const fs = require('fs');
const missing = FOOD_CATALOG.filter(f => !fs.existsSync(\`assets/foods/\${f.icon}.webp\`));
if (missing.length) { console.error('Missing icons:', missing.map(f => f.icon)); process.exit(1); }
console.log('All', FOOD_CATALOG.length, 'food icons present.');
"
```

(This is CommonJS `require` against an ES module file — adjust to whatever this repo's actual Node module system/test-runner convention is; `js/store.test.js` already imports `.js` files as ES modules under `node --test`, so a `node --experimental-vm-modules` or a plain `import`-based one-off script may be the more consistent choice — match the existing pattern rather than introducing a second module style.)

Expected: no missing icons reported. **Do not proceed to Step 3 until this passes** — this is the guard against the service-worker cache-atomicity risk described below.

- [ ] **Step 3: Add the assets to the service-worker precache manifest, only after Step 2 passes**

In `sw.js`, find the `cache.addAll([...])` call (~lines 42-46) and add every `assets/foods/<icon>.webp` path. `cache.addAll()` fails atomically — if any single listed URL 404s, the *entire* offline install breaks, not just food icons — which is why Step 2's existence check must pass first, and why every added path must come from files that actually exist on disk at commit time, not from a list of icons still pending generation.

- [ ] **Step 4: Manual offline-install check**

Load the app, let the service worker install, go offline (devtools Network tab → Offline), reload, confirm the app still boots and the food picker's icons still render (from cache, not network).

- [ ] **Step 5: Commit**

```bash
git add assets/foods/ sw.js
git commit -m "feat(solid): generate and precache food icon assets"
```

---

### Task 11: Backend confirmation test for `type: 'solid'` payloads

Note on ordering: this task is deliberately last rather than moved next to Task 1, even though it's cheap and validates an assumption (`entries.go`'s generic upsert handler round-trips a `foods` array unchanged) that every earlier UI task implicitly relies on. Running it first would catch a wrong assumption sooner, but the assumption itself was independently verified by reading `server/entries.go` before this plan was written (it stores `payload_json` as the raw request body regardless of `type` — there's no field allowlist to trip over), so the risk this task is actually guarding against is low. Left at the end to keep all-Go and all-JS work each contiguous rather than interleaved; move it earlier if the implementer wants the extra confidence before starting Task 5's UI work.

**Files:**
- Modify: `server/entries_test.go`

**Interfaces:**
- Consumes: `handleUpsertEntry` (unchanged — already fully generic over `type`, per `server/entries.go:23-54`).
- Produces: nothing new — this is a confirmation test only, no new server logic.

- [ ] **Step 1: Write the test**

Following the exact structure of `TestHandleUpsertEntryCreates` (`server/entries_test.go:12-33`):

```go
func TestHandleUpsertEntryAcceptsSolidType(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	body := `{"type":"solid","start":"2026-08-15T10:00:00Z","foods":[{"key":"banana","label":"Banana","amount":"Some","reaction":"likes","allergy":false}],"note":null}`
	req := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(body))
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertEntry(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var typ, payload string
	if err := db.QueryRow(`SELECT type, payload_json FROM log_entries WHERE id = 'e1'`).Scan(&typ, &payload); err != nil {
		t.Fatal(err)
	}
	if typ != "solid" {
		t.Errorf("type = %q, want solid", typ)
	}
	if !strings.Contains(payload, `"foods"`) {
		t.Errorf("payload_json = %q, want it to retain the foods field verbatim", payload)
	}
}
```

- [ ] **Step 2: Run the test**

Run: `go test ./server/... -run TestHandleUpsertEntryAcceptsSolidType -v`
Expected: PASS (this confirms, rather than changes, behavior — `server/entries.go` stores `payload_json` as the raw request body regardless of `type`, so a `solid` payload with a `foods` array round-trips with zero server-side code changes)

- [ ] **Step 3: Run the full server suite to confirm nothing regressed**

Run: `go test ./server/...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/entries_test.go
git commit -m "test(solid): confirm the server accepts and round-trips solid-type payloads"
```

---

### Task 12: Bump version, changelog, and finish the branch

**Files:**
- Modify: `index.html`, `sw.js` (via `scripts/bump-version.sh`)
- Modify: `js/changelog.js`

- [ ] **Step 1: Add a changelog entry**

Add a `feat` entry to today's dated block in `js/changelog.js`, e.g. "You can now log solid foods — what your baby ate, how much, and how they reacted — with a new Solids card on Home and a Foods tried list." Match the file's existing entry format and ordering (features before fixes within the day's block).

- [ ] **Step 2: Bump the version**

```bash
scripts/bump-version.sh
```

- [ ] **Step 3: Run the full local test set for the files this unit touched**

```bash
node --test js/store.test.js
go test ./server/...
```

Expected: both PASS. For the Playwright specs (`tests/solids-logging.test.js` and any others touched), run them locally once more with `CHROMIUM=/usr/bin/chromium` and `CONCURRENCY=1`, then lean on CI's full matrix as the gate for the rest, per project convention — this unit touches `app.js`/`sheets.js`/`home.js`/`ui.js`/`timeline.js`/`sw.js` broadly enough that a full local run would fight shared-box contention for little extra signal beyond what CI already covers.

- [ ] **Step 4: Commit**

```bash
git add js/changelog.js index.html sw.js
git commit -m "chore(solid): bump version and changelog for the solids feeding log"
```

- [ ] **Step 5: Open the PR**

Use `superpowers:finishing-a-development-branch`. Title e.g. `feat(solid): add solids feeding log, Home card, and foods-tried rollup`. Reference the spec section. This is the largest, most novel unit in the batch — get review at effort level `high` (new entry type, new data shape, new sync-ingress sanitization path, new form machinery, new asset pipeline) before merging.
