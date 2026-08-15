# Diaper Copy: "Dirty" → "Poo" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing "Dirty" diaper label to "Poo" everywhere it's displayed, without touching the underlying `kind: 'Dirty'` data value, field names, or migrations.

**Architecture:** Pure display-layer change. The diaper form's segmented control already supports `{val, label}` option objects (`seg()` in `js/sheets.js`), so swapping the displayed label for the `Dirty` option is a one-line change there. The Home/Timeline entry-summary renderer (`summary()` in `js/home.js`) builds its label text from `e.kind.toLowerCase()` directly, so it needs a small label lookup instead. Nothing else in the codebase renders `kind` to a user.

**Tech Stack:** Vanilla JS, no framework. Tests: `node --test js/store.test.js` (unit), Playwright specs under `tests/`.

**Spec:** `.superpowers/specs/2026-08-15-dogfood-solids-nav-design.md`, Section 1 ("Diaper copy: 'Dirty' → 'Poo'")

## Global Constraints

- Copy-only change. The internal `kind: 'Dirty'` value, `wetSize`/`dirtySize` field names, `normalizeLog`'s existing Mixed-diaper migration (`store.js:89`), and all data-level test assertions on `'Dirty'`/`'dirtySize'` stay exactly as-is.
- Follow Conventional Commits for every commit message.
- Run `scripts/bump-version.sh` before the final commit of this unit (project rule: every user-visible change bumps the version).
- Add a one-line changelog entry to `js/changelog.js` under today's dated block (this is a user-facing `fix`/copy change parents will notice).

---

### Task 1: Rename the diaper-type segmented control label

**Files:**
- Modify: `js/sheets.js:509` (the `diaper` form template in the `FORMS` object)
- Modify: `js/sheets.js:513` (the "Dirty size" field label inside the Mixed sub-form)
- Test: `tests/diaper-mixed-size.test.js` (existing suite — verify it still passes; it asserts on `data-val="Dirty"`, not display text, so no test code changes are expected, but run it to confirm)

**Interfaces:**
- Consumes: `seg(group, opts, sel)` from `js/sheets.js:9` — already accepts either a bare string option (`val === label`) or an object `{ val, label }` where `val` is the stored/matched value and `label` is the rendered text.
- Produces: nothing new — this is a leaf change other tasks don't depend on.

- [ ] **Step 1: Change the segmented-control option to a label override**

In `js/sheets.js`, find the `diaper` entry in the `FORMS` object:

```js
diaper: () => `
    ${field('Type', seg('kind', ['Wet', 'Dirty', 'Mixed'], 'Wet'))}
```

Change the `'Dirty'` bare string to an object with a display-only label override, keeping the stored value `'Dirty'`:

```js
diaper: () => `
    ${field('Type', seg('kind', ['Wet', { val: 'Dirty', label: 'Poo' }, 'Mixed'], 'Wet'))}
```

Then, a few lines down in the same template, change the "Dirty size" field label:

```js
      ${field('Dirty size', seg('dirtySize', SIZE_OPTS, 'Medium'))}
```

to:

```js
      ${field('Poo size', seg('dirtySize', SIZE_OPTS, 'Medium'))}
```

Note: only the label strings change. `seg('dirtySize', ...)` still uses the group name `dirtySize` and `SIZE_OPTS`'s stored values (`Small`/`Medium`/`Large`) — those are untouched.

- [ ] **Step 2: Manually verify the segmented control still matches by value, not label**

Run: `node --test js/store.test.js`
Expected: PASS (no test touches this rendering path, but this confirms nothing else broke)

- [ ] **Step 3: Run the existing diaper Playwright spec**

Run: `CHROMIUM=/usr/bin/chromium node tests/run.js diaper-mixed-size`
(If `tests/run.js` doesn't support a name filter, run the full file directly: check `tests/run.js --help` first, or run `CHROMIUM=/usr/bin/chromium node tests/diaper-mixed-size.test.js` if the suite files are directly executable — confirm the actual invocation from `package.json`'s `test` script before running.)
Expected: PASS — this suite clicks `[data-seg="kind"] .seg-opt[data-val="Dirty"]` and asserts on `savedDirty.kind === 'Dirty'`, both of which key off `data-val`/stored data, not the rendered label text, so they're unaffected by this change.

- [ ] **Step 4: Commit**

```bash
git add js/sheets.js
git commit -m "fix(diaper): relabel Dirty diaper type as Poo in the log form"
```

---

### Task 2: Rename the diaper-kind label in entry summaries (Home card + Timeline)

**Files:**
- Modify: `js/home.js` (the `summary()` function, ~line 18-53)
- Test: `js/home.test.js` (existing suite — it already imports `summary` from `home.js` via `const { bathDaysSinceLabel, home, summary } = await import('./home.js');` at line 15, with a proven mock DOM harness that other `summary()` tests already run under, e.g. the `play` entry tests at lines 33-38 — add the new diaper tests here, not `js/store.test.js`, whose minimal DOM shim isn't proven against `home.js`'s import chain)

**Interfaces:**
- Consumes: `summary(e)` export from `js/home.js`, already used by both `js/home.js`'s own Today card and `js/timeline.js`'s day-log rows (`import { summary, hasUnshownNote } from './home.js'` in `timeline.js:4`) — this is the single shared renderer for both surfaces, so one fix covers both.
- Produces: no new exports; `summary()`'s signature and return shape (`{ label, detail, meta, tone, icon }`) are unchanged.

- [ ] **Step 1: Write the failing test**

Add a new test block to `js/home.test.js`, following the file's existing style (see the `play`-entry tests around lines 33-38 for the import/assertion pattern already proven to run under this file's mock harness):

```js
test('diaper summary label reads Poo, not Dirty', () => {
  const entry = { type: 'diaper', kind: 'Dirty', start: new Date().toISOString(), size: 'Medium' };
  const s = summary(entry);
  assert.equal(s.label, 'Diaper · poo');
});

test('diaper summary label for Wet is unchanged', () => {
  const entry = { type: 'diaper', kind: 'Wet', start: new Date().toISOString(), size: 'Medium' };
  const s = summary(entry);
  assert.equal(s.label, 'Diaper · wet');
});

test('diaper summary label for Mixed is unchanged', () => {
  const entry = { type: 'diaper', kind: 'Mixed', start: new Date().toISOString(), wetSize: 'Medium', dirtySize: 'Small' };
  const s = summary(entry);
  assert.equal(s.label, 'Diaper · mixed');
});
```

(If `home.js` isn't importable standalone in the test environment — check whether other tests already import from `home.js`, `ui.js`, etc. If the test file mocks `localStorage`/DOM globals for `store.js` imports, `home.js` may need the same setup already present earlier in the file; follow the existing pattern rather than inventing a new one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test js/store.test.js`
Expected: FAIL on the first new test — `s.label` is `'Diaper · dirty'`, not `'Diaper · poo'`.

- [ ] **Step 3: Add a kind-label lookup and use it in `summary()`**

In `js/home.js`, near the existing `SIZE_LABELS`/`sizeLabel()` helper (~line 15-16), add a parallel lookup for diaper kind display text:

```js
const KIND_LABELS = { Wet: 'wet', Dirty: 'poo', Mixed: 'mixed' };
function kindLabel(k) { return KIND_LABELS[k] || (k || '').toLowerCase(); }
```

Then change the diaper branch of `summary()` (currently):

```js
  } else if (e.type === 'diaper') {
    label = 'Diaper · ' + (e.kind || '').toLowerCase(); detail = fmt.clock(e.start);
```

to:

```js
  } else if (e.type === 'diaper') {
    label = 'Diaper · ' + kindLabel(e.kind); detail = fmt.clock(e.start);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS, all three new tests green.

- [ ] **Step 5: Commit**

```bash
git add js/home.js js/store.test.js
git commit -m "fix(diaper): relabel Dirty as Poo in Home/Timeline entry summaries"
```

---

### Task 3: Bump version and update changelog, then finish the branch

**Files:**
- Modify: `index.html` and `sw.js` (via `scripts/bump-version.sh` — do not hand-edit)
- Modify: `js/changelog.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is the closing task for the unit.

- [ ] **Step 1: Add a changelog entry**

Open `js/changelog.js` and find (or create, if today's date isn't yet present) the dated block for today. Add a one-line, parent-facing `fix` entry describing the rename, e.g. `"Diaper log now says 'Poo' instead of 'Dirty'"`. Follow the file's existing structure for where fixes go relative to features within a day's block (read a couple of nearby existing entries to match format).

- [ ] **Step 2: Bump the version**

```bash
scripts/bump-version.sh
```

Verify the printed `index.html` and `sw.js` version lines both show the new UTC timestamp.

- [ ] **Step 3: Run the full unit suite one more time**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/changelog.js index.html sw.js
git commit -m "chore(diaper): bump version and changelog for Poo copy rename"
```

- [ ] **Step 5: Open the PR**

Use `superpowers:finishing-a-development-branch` to push the branch and open a PR titled something like `fix(diaper): relabel Dirty as Poo`. Reference the spec section in the PR description. Do not merge until reviewed per project convention (`/code-review` → `ferrying-code-review`, effort level `low` — this is a small, contained, copy-only diff).
