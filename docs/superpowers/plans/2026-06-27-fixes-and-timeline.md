# Fixes & Timeline Implementation Plan

> **Status:** COMPLETE — merged to `main`. Timeline view, bath days-since card, medicine card redesign, segmented slider thumb, and desktop date autofill shipped; `tests/{timeline,segthumb,bathcard,medcard,spinner}.test.js` cover them.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three bug fixes, two card features (bath days-since, medicine card redesign), and a filterable day-grouped Timeline, sequenced as independent milestones.

**Architecture:** Vanilla-JS PWA. UI is rendered by view functions returning HTML strings into `#view`; behavior runs through a single delegated click handler in `js/app.js` keyed on `data-action`. Settings/log live in `js/store.js` (`state()`, `derive`). Pure helpers get `node:test` unit tests (`js/*.test.js`); DOM behavior gets Playwright tests (`tests/*.test.js`).

**Tech Stack:** Vanilla JS (ES modules), CSS custom properties, Go + SQLite backend (untouched here), `node:test`, Playwright.

## Global Constraints

- No framework. Vanilla JS PWA + Go + SQLite.
- **Bump the version on every change to a cached user-facing asset.** Update `index.html` (`<meta name="version">`) and `sw.js` (`VERSION`) to `date -u +%Y-%m-%dT%H:%MZ`. The two strings must match except `sw.js` carries the `hearth-` prefix. Do this BEFORE committing. Tooling/test-only diffs do NOT bump.
- Lucide icons only (inline SVG sprite in `index.html`). Round controls, glass language, Archivo/Playfair type.
- Conventional Commits for git messages (`<type>(<scope>): <desc>`, imperative).
- Phases 1–3 are independent and ship as separate PRs. Each phase is one milestone.
- Use `fd`/`rg`, never `find`/`grep`.

---

## Phase 1 — Quick fixes

### Task 1: Segmented "slider" thumb shows on refresh

**Problem:** `router.go()` calls `initThumbs($('#view'))` but `router.refresh()` does not (`js/app.js:90`), so any refresh-driven re-render (sync, 60s tick, toggling a setting) leaves `.seg-thumb` at width 0. Additionally `positionThumb()` bails when no `.seg-opt.on` exists, which happens if a stored setting value matches no option `data-val` (legacy boolean `settings.clock24`).

**Files:**
- Modify: `js/app.js:90` (`router.refresh`)
- Modify: `js/store.js` (settings load normalization, near the `load()`/state-hydration path around lines 60–72)
- Test: `js/store.test.js` (normalization unit test), `tests/segthumb.test.js` (new Playwright test)

**Interfaces:**
- Produces: `normalizeSettings(settings)` in `js/store.js` — coerces legacy `clock24` (`true`→`'24h'`, `false`→`'12h'`) and leaves valid values untouched; returns the same object. Called during load.

- [ ] **Step 1: Write the failing unit test for clock24 normalization**

Add to `js/store.test.js`:

```js
test('normalizeSettings coerces legacy boolean clock24 to a string option value', async () => {
  const { normalizeSettings } = await import('./store.js');
  assert.equal(normalizeSettings({ clock24: true }).clock24, '24h');
  assert.equal(normalizeSettings({ clock24: false }).clock24, '12h');
  assert.equal(normalizeSettings({ clock24: '24h' }).clock24, '24h');
  assert.equal(normalizeSettings({ clock24: '12h' }).clock24, '12h');
  assert.equal(normalizeSettings({}).clock24, '12h');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `normalizeSettings is not a function` (or undefined export).

- [ ] **Step 3: Implement `normalizeSettings` and call it during load**

In `js/store.js`, add the exported helper near the other settings helpers:

```js
export function normalizeSettings(s) {
  if (!s) return s;
  if (s.clock24 === true) s.clock24 = '24h';
  else if (s.clock24 === false) s.clock24 = '12h';
  else if (s.clock24 !== '24h' && s.clock24 !== '12h') s.clock24 = '12h';
  return s;
}
```

Then normalize the hydrated settings inside `load()` (the path that reads
`localStorage.getItem('hearth.state.v1')` and builds the merged object `s` it
returns — note it operates on the local `s`, **not** `_state`). Exact find/replace in
`js/store.js`:

Find:
```js
      if (s.cards) {
        delete s.cards.sweetspot;
        if (Array.isArray(s.cards.order)) s.cards.order = s.cards.order.filter((k) => k !== 'sweetspot');
      }
      return s;
```
Replace:
```js
      if (s.cards) {
        delete s.cards.sweetspot;
        if (Array.isArray(s.cards.order)) s.cards.order = s.cards.order.filter((k) => k !== 'sweetspot');
      }
      normalizeSettings(s.settings);
      return s;
```

- [ ] **Step 4: Run the unit test and confirm it passes**

Run: `node --test js/store.test.js`
Expected: PASS (all tests, including the existing `fmt.clock honors the clock24 setting`).

- [ ] **Step 5: Make `router.refresh()` re-init thumbs**

In `js/app.js`, replace the `refresh` method (line 90). `initThumbs` is already imported (`js/app.js:4`):

```js
  refresh() {
    if ($('#view')) { $('#view').innerHTML = VIEWS[current]({}); initThumbs($('#view')); }
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === current));
  }
```

- [ ] **Step 6: Write a Playwright test for the thumb rendering**

Create `tests/segthumb.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18791);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('.segctl');
    // Every segmented control's thumb must have non-zero width after first nav.
    const widthsAfterNav = await page.$$eval('.segctl .seg-thumb', els => els.map(e => e.getBoundingClientRect().width));
    check('all thumbs have width on first nav', widthsAfterNav.length > 0 && widthsAfterNav.every(w => w > 4), JSON.stringify(widthsAfterNav));
    // Toggle a different setting to force a refresh, then re-check.
    await page.click('.set-row .switch'); // first toggle on the profile page
    await page.waitForTimeout(200);
    const widthsAfterRefresh = await page.$$eval('.segctl .seg-thumb', els => els.map(e => e.getBoundingClientRect().width));
    check('all thumbs still have width after refresh', widthsAfterRefresh.every(w => w > 4), JSON.stringify(widthsAfterRefresh));
  } catch (e) {
    check('segthumb test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
```

- [ ] **Step 7: Run the Playwright test and confirm it passes**

Run: `node tests/segthumb.test.js`
Expected: `2 pass, 0 fail`.

- [ ] **Step 8: Confirm live in the running app**

Use the `run` skill to launch the app. Navigate to Profile → confirm every segmented control (Dark mode, Volume, Temperature, Weight, Length, Clock) shows its sliding thumb on first navigation. Toggle "Sound & haptics" to force a refresh and confirm the thumbs remain positioned.

- [ ] **Step 9: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html <meta name="version"> to $TS and sw.js VERSION to hearth-$TS
node tests/run.js && npm run check
git add index.html sw.js js/app.js js/store.js js/store.test.js tests/segthumb.test.js
git commit -m "fix(ui): render segmented thumb on refresh and normalize clock24"
```

---

### Task 2: Refined-glass slider restyle

**Problem:** `.seg-thumb` (`styles.css:770-792`) stacks a moving glare plus two radial gradients and a fire-coupled drop shadow, reading muddy/heavy.

**Files:**
- Modify: `styles.css:770-793` (`.seg-thumb`) and `:806-813` (`[data-mode="dark"] .seg-thumb`)

**Interfaces:** None (pure CSS).

- [ ] **Step 1: Simplify the light-mode `.seg-thumb`**

Replace the `background-image`, `background-size`, and `box-shadow` declarations in `.seg-thumb` (keep `position`, `top/bottom/left`, `border-radius`, `pointer-events`, `background-color`, and the `transition` block exactly as they are). The moving glare highlight stays; the two radial gradients go; the fire-coupled shadow term (`var(--fire-a)`) is replaced by one static soft cast shadow plus one crisp top inset highlight:

```css
.seg-thumb {
  position: absolute;
  top: 4px; bottom: 4px; left: 0;
  border-radius: 10px;
  pointer-events: none;
  background-color: var(--surface);
  background-image:
    linear-gradient(100deg,
      transparent calc(var(--glare, 0.5) * 100% - 26%),
      oklch(1 0 0 / 0.28) calc(var(--glare, 0.5) * 100%),
      transparent calc(var(--glare, 0.5) * 100% + 26%));
  box-shadow:
    0 1px 0 oklch(0.99 0.01 75 / 0.7) inset,
    0 2px 6px var(--mat-cast);
  transition:
    transform 0.42s cubic-bezier(0.34, 1.4, 0.5, 1),
    width 0.42s cubic-bezier(0.34, 1.4, 0.5, 1),
    --glare 0.42s cubic-bezier(0.34, 1.4, 0.5, 1);
}
```

- [ ] **Step 2: Simplify the dark-mode `.seg-thumb` the same way**

Replace the `[data-mode="dark"] .seg-thumb` block (`styles.css:806-813`), preserving its `background-color` and dropping the fire-coupled shadow term:

```css
[data-mode="dark"] .seg-thumb {
  background-color: oklch(0.30 0.030 48);
  box-shadow:
    0 1px 0 oklch(0.62 0.18 48 / 0.22) inset,
    0 2px 8px oklch(0 0 0 / 0.55);
}
```

- [ ] **Step 3: Re-tune against live screenshots in both modes**

Use the `run` skill (it supports screenshots) to capture Profile in light mode and dark mode. Confirm the thumb reads crisp (not muddy), the glare still tracks the selected option, and contrast against the track is acceptable in both modes. Nudge the glare opacity (`0.28`) or inset highlight if needed.

- [ ] **Step 4: Bump version and commit**

```bash
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html + sw.js to $TS / hearth-$TS
git add index.html sw.js styles.css
git commit -m "style(ui): refine segmented slider thumb to crisp glass"
```

---

### Task 3: Desktop date autofill (reproduce-first)

**Problem:** On desktop, opening a logging sheet leaves the date portion of `datetime-local` unfilled. `nowLocalDT()` (`js/ui.js:313`) returns a valid `YYYY-MM-DDTHH:MM`, so the value *should* populate. This is a reproduce-first bug — do not guess.

**REQUIRED SUB-SKILL:** Use superpowers:systematic-debugging.

**Files:**
- Likely modify: `js/ui.js` (`nowLocalDT`) or `js/sheets.js` (`timeRow`, `FORMS`, `openLog`) — determined by the investigation, not assumed.
- Test: `tests/datetime.test.js` (new Playwright test)

- [ ] **Step 1: Reproduce in the browser and form a hypothesis**

Use the `run` skill on desktop Chromium. Open a sleep log sheet. Inspect `#f-time` in DevTools: read its `.value` and the rendered control. Determine whether (a) the `value=` attribute is correct but the control renders only time, (b) `nowLocalDT()` returns a malformed string, or (c) the input is re-rendered/replaced after injection. Write the confirmed root cause as a one-line note before changing code.

- [ ] **Step 2: Write a failing Playwright test that asserts the date is prefilled**

Create `tests/datetime.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18792);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('#f-time');
    const val = await page.$eval('#f-time', el => el.value);
    // datetime-local value must be a full YYYY-MM-DDTHH:MM, date portion non-empty.
    check('sleep sheet #f-time has a full datetime value', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val), val);
  } catch (e) {
    check('datetime test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
```

- [ ] **Step 3: Run it and confirm it fails (reproduces the bug)**

Run: `node tests/datetime.test.js`
Expected: FAIL — date portion missing/empty, matching the live repro.

- [ ] **Step 4: Apply the minimal fix identified in Step 1**

Implement the smallest change that addresses the confirmed root cause. (If `nowLocalDT()` is correct and the value attribute is present, the fix likely lives in how `openLog`/`timeRow` injects or re-renders the input — e.g. setting `.value` imperatively after `sheet.open()` rather than via the `value=` attribute. Match the established pattern used by `prefill()` in `js/sheets.js`.)

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node tests/datetime.test.js`
Expected: `1 pass, 0 fail`.

- [ ] **Step 6: Confirm live across sheets**

Use `run` to verify sleep, feed, bottle, diaper, and note sheets all open with both date and time prefilled to now on desktop.

- [ ] **Step 7: Run the full suite, bump version (if a cached asset changed), and commit**

```bash
node tests/run.js && npm run check
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# If js/ or index.html changed: update index.html + sw.js to $TS / hearth-$TS
git add -A
git commit -m "fix(sheets): prefill the date portion of datetime-local on desktop"
```

---

## Phase 2 — Card features

### Task 4: Bath days-since card

**Goal:** Render the bath card as a "Last bath — Today/Yesterday/N days ago/Never" display instead of a generic interval timer. Tapping it opens the bath logging sheet. No interval, no reminder.

**Files:**
- Modify: `js/home.js` (`bathCard`, `CARD_RENDER`, export `bathDaysSinceLabel`)
- Modify: `js/sheets.js` (`pickCard`, `editCard` — bath needs no interval)
- Test: `js/home.test.js` (new) for `bathDaysSinceLabel`

**Interfaces:**
- Produces: `bathDaysSinceLabel(iso)` in `js/home.js` — `iso` is an ISO start string or `null`; returns `'Today' | 'Yesterday' | 'N days ago' | 'Never'`, computed on local calendar-day boundaries.
- Consumes: existing `state().log` (newest-first), `TYPES.bath`, `icon()`, `icEdit()`, `cardEditMode` from `js/home.js`.

- [ ] **Step 1: Write the failing unit test for `bathDaysSinceLabel`**

Create `js/home.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage so home.js's imports resolve under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { bathDaysSinceLabel } = await import('./home.js');

const atDaysAgo = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() - n); return d.toISOString(); };

test('bathDaysSinceLabel returns Never for no entry', () => {
  assert.equal(bathDaysSinceLabel(null), 'Never');
});
test('bathDaysSinceLabel returns Today for an entry earlier today', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(0)), 'Today');
});
test('bathDaysSinceLabel returns Yesterday for one calendar day ago', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(1)), 'Yesterday');
});
test('bathDaysSinceLabel returns N days ago for older entries', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(3)), '3 days ago');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test js/home.test.js`
Expected: FAIL — `bathDaysSinceLabel is not a function`.

- [ ] **Step 3: Implement `bathDaysSinceLabel` and `bathCard`, register in `CARD_RENDER`**

In `js/home.js`, add the exported helper:

```js
export function bathDaysSinceLabel(iso) {
  if (!iso) return 'Never';
  const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((midnight(Date.now()) - midnight(iso)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return days + ' days ago';
}
```

Add the card renderer (place near `genericCard`):

```js
function bathCard() {
  const items = state().log.filter((e) => e.type === 'bath'); // newest-first
  const last = items.length ? items[0] : null;
  const label = bathDaysSinceLabel(last ? last.start : null);
  return `<div class="info-card" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bath" data-card="bath">
    <div class="ic-ring tone-${TYPES.bath.tone}"><svg class="icon"><use href="#${icon(TYPES.bath.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Last bath</div>
      <div class="ic-val">${esc(label)}</div>
    </div>
    ${icEdit('bath')}
  </div>`;
}
```

Register it so bath renders as a days-since card rather than a generic timer:

```js
const CARD_RENDER = { bottle: bottleCard, medicine: medicineCard, bath: bathCard };
```

- [ ] **Step 4: Run the unit test and confirm it passes**

Run: `node --test js/home.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Make bath add/edit skip the interval prompt**

Because bath is now in `CARD_RENDER`, `renderable('bath')` is always true and the picker/editor must not ask for an interval. In `js/sheets.js`, update `pickCard` (currently special-cases only bottle/medicine):

```js
export function pickCard(type) {
  // Re-adding a hidden default just unhides it; bath is a no-interval days-since card.
  if (type === 'bottle' || type === 'medicine' || type === 'bath') {
    if (type === 'bath') {
      const cards = state().settings.cards;
      cards.order = cards.order || ['bottle', 'medicine'];
      if (!cards.order.includes('bath')) cards.order.push('bath');
      cards.bath = true;
      save(); enqueueSettingsSync(); sheet.close(); toast('Bath card added'); router.refresh();
      return;
    }
    showCard(type); return;
  }
  const c = TYPES[type] || { label: type };
  sheet.open(`
    ${stepperField('Remind every (hours)', 'c-int', 1, 24, 0.5, 3)}
    <p class="empty-note">Next ${esc(c.label.toLowerCase())} is predicted from the last entry plus this interval.</p>
    <button class="btn-primary" data-action="card:save-new" data-card="${type}"><svg class="icon"><use href="#check"></use></svg> Add card</button>`,
    { title: 'Add ' + c.label });
}
```

Update `editCard` so the bath branch offers only removal (no interval stepper). In `js/sheets.js`, add a bath case before the generic `else`:

```js
  } else if (which === 'bath') {
    sheet.open(`
      <p class="empty-note">The bath card shows how long since the last bath. There's no reminder interval to set.</p>
      <button class="btn-ghost danger" data-action="card:remove" data-card="bath"><svg class="icon"><use href="#trash-2"></use></svg> Remove card</button>`,
      { title: 'Bath card' });
  } else {
```

(`removeCard` already deletes the order entry and `cards[type]`; harmless that bath has no `intervals` key.)

- [ ] **Step 6: Verify the bath card live**

Use `run`. Add the Bath card via "Add card". Confirm it reads "Last bath — Never". Log a bath; confirm it updates to "Today". Tap the card and confirm it opens the bath logging sheet. Enter card edit mode and confirm Edit → "Remove card" works.

- [ ] **Step 7: Run the suite, bump version, and commit**

```bash
node tests/run.js && npm run check
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html + sw.js to $TS / hearth-$TS
git add index.html sw.js js/home.js js/sheets.js js/home.test.js
git commit -m "feat(home): add bath days-since card"
```

---

### Task 5: Medicine card redesign

**Goal:** Remove the dead-end loop. With **no medicines**, the card shows a **+** and "Add a medicine" and tapping it opens the create/manage medicine form. With **medicines defined**, tapping logs a dose: one medicine logs directly (with undo toast); several open a dose picker. The small edit button still manages the list.

**Files:**
- Modify: `js/home.js` (`medicineCard` — empty state + card action)
- Modify: `js/sheets.js` (add `openMedCard`, `logMedDose`)
- Modify: `js/app.js` (route `med:card` and `med:dose`; import the two functions)

**Interfaces:**
- Produces: `openMedCard()` in `js/sheets.js` — no meds → opens the manage form (`editCard('medicine')`); exactly one → `logMedDose(meds[0].id)`; several → opens a dose-picker sheet whose items carry `data-action="med:dose" data-mid`.
- Produces: `logMedDose(medId)` in `js/sheets.js` — builds and adds a `medicine` log entry for `medId` (`{ type:'medicine', start: now ISO, medId, name, dose: dose+unit }`), closes the sheet, fires chime/buzz/confetti per existing `saveLog`, shows an undo toast, and refreshes.
- Consumes: `state().settings.meds`, `addEntry`, `removeEntry`, `sheet`, `toast`, `chime`, `buzz`, `confetti`, `router`, `editCard` (all already in `js/sheets.js` scope).

- [ ] **Step 1: Add `logMedDose` and `openMedCard` to `js/sheets.js`**

```js
export function logMedDose(medId) {
  const m = state().settings.meds.find((x) => x.id === medId);
  if (!m) return;
  const e = { type: 'medicine', start: new Date().toISOString(), medId: m.id, name: m.name, dose: m.dose + m.unit };
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(m.name + ' logged', () => { removeEntry(added.id); router.refresh(); });
  router.refresh();
}

export function openMedCard() {
  const meds = state().settings.meds;
  if (!meds.length) { editCard('medicine'); return; }      // create/manage form
  if (meds.length === 1) { logMedDose(meds[0].id); return; } // log directly
  sheet.open(
    `<div class="chooser">` + meds.map((m) => `
      <button class="chooser-item" data-action="med:dose" data-mid="${m.id}">
        <span class="chooser-ic tone-med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></span>
        <span>${esc(m.name)} · ${esc(m.dose)}${esc(m.unit)}</span>
      </button>`).join('') + `</div>`,
    { title: 'Log a dose' }
  );
}
```

- [ ] **Step 2: Point the card and empty state at `med:card` in `js/home.js`**

Replace `medicineCard()` so the whole card uses the new action and the empty state shows a `+`:

```js
function medicineCard() {
  const meds = derive.nextMeds();
  const next = meds.find((m) => m.due) || meds[0];
  const action = cardEditMode ? '' : 'data-action="med:card"';
  if (!next) {
    return `<div class="info-card" ${action} data-card="medicine">
      <div class="ic-ring med"><svg class="icon"><use href="#plus"></use></svg></div>
      <div class="ic-txt"><div class="ic-lbl">Medicine</div><div class="ic-val">Add a medicine</div></div>
      ${icEdit('medicine')}
    </div>`;
  }
  let val, lbl;
  if (!next.due) { lbl = next.med.name + ' · every ' + next.med.everyH + 'h'; val = 'Not given yet'; }
  else {
    const overdue = next.due < new Date();
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${overdue ? 'due now' : fmt.untilOrAgo(next.due)}</span>`;
  }
  return `<div class="info-card" ${action} data-card="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">Next medicine</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('medicine')}
  </div>`;
}
```

- [ ] **Step 3: Route the new actions in `js/app.js`**

Add `openMedCard, logMedDose` to the `js/sheets.js` import (line 13), then add two entries to the `map` in the click delegation (near `med:add`):

```js
    'med:card': () => openMedCard(),
    'med:dose': () => logMedDose(d.mid),
```

- [ ] **Step 4: Lint/parse check**

Run: `npm run check`
Expected: passes (no syntax errors, eslint clean).

- [ ] **Step 5: Write a Playwright test for the three states**

Create `tests/medcard.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18793);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    // Ensure the medicine card is present (default cards include it).
    await page.waitForSelector('[data-card="medicine"]');
    // Empty state: tapping opens the manage/create form (med-list present).
    await page.click('[data-card="medicine"]');
    await page.waitForSelector('#med-list', { timeout: 3000 });
    check('empty medicine card opens manage form', true);
    // Add exactly one medicine and save.
    await page.click('[data-action="med:add"]');
    await page.fill('#med-list .med-edit:last-child .med-name', 'Vitamin D');
    await page.click('[data-action="card:save-meds"]');
    await page.waitForTimeout(300);
    // Single medicine: tapping the card logs a dose directly (toast appears, no picker).
    await page.click('[data-card="medicine"]');
    await page.waitForTimeout(300);
    const toastVisible = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('single medicine logs directly with a toast', toastVisible);
  } catch (e) {
    check('medcard test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
```

- [ ] **Step 6: Run the Playwright test and confirm it passes**

Run: `node tests/medcard.test.js`
Expected: `2 pass, 0 fail`.

- [ ] **Step 7: Verify live, including the multi-medicine picker**

Use `run`. With zero meds: card shows + / "Add a medicine" and opens the create form. Add two meds. Tapping the card now opens the "Log a dose" picker; picking one logs it with an undo toast. The small edit (sliders) button still opens the manage list. Undo removes the logged dose.

- [ ] **Step 8: Run the suite, bump version, and commit**

```bash
node tests/run.js && npm run check
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html + sw.js to $TS / hearth-$TS
git add index.html sw.js js/home.js js/sheets.js js/app.js tests/medcard.test.js
git commit -m "feat(home): redesign medicine card for direct dosing and clear empty state"
```

---

## Phase 3 — Timeline

### Task 6: Timeline day-grouping logic (pure, TDD)

**Goal:** A pure function that groups log entries into reverse-chronological day buckets with human labels, used by the Timeline view.

**Files:**
- Create: `js/timeline.js` (`groupByDay`, plus the view in Task 7)
- Create: `js/timeline.test.js`

**Interfaces:**
- Produces: `groupByDay(entries, now = Date.now())` in `js/timeline.js` — takes entries (any order), returns an array of `{ key: string, label: string, items: Entry[] }` sorted newest-day-first, items within each group newest-first by `start`. `label` is `'Today' | 'Yesterday' | <"Tue, Jun 24" via toLocaleDateString>`. `key` is the `YYYY-MM-DD` local date string.

- [ ] **Step 1: Write the failing unit test**

Create `js/timeline.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

const { groupByDay } = await import('./timeline.js');

const dayMs = 86400000;
function isoAt(daysAgo, hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); d.setTime(d.getTime() - daysAgo * dayMs); return d.toISOString(); }

test('groupByDay buckets entries by local day, newest day first', () => {
  const entries = [
    { id: 'a', type: 'feed', start: isoAt(0, 9) },
    { id: 'b', type: 'sleep', start: isoAt(0, 14) },
    { id: 'c', type: 'diaper', start: isoAt(1, 10) },
    { id: 'd', type: 'bottle', start: isoAt(3, 8) },
  ];
  const groups = groupByDay(entries);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].label, 'Today');
  assert.equal(groups[1].label, 'Yesterday');
  // Today bucket: items newest-first → 14:00 (b) before 09:00 (a).
  assert.deepEqual(groups[0].items.map(e => e.id), ['b', 'a']);
  // Oldest group keeps its two items? No — group d alone.
  assert.equal(groups[2].items.length, 1);
  assert.equal(groups[2].items[0].id, 'd');
  // Dated label format for the 3-days-ago group is non-empty and not Today/Yesterday.
  assert.ok(groups[2].label && !['Today', 'Yesterday'].includes(groups[2].label));
});

test('groupByDay returns [] for no entries', () => {
  assert.deepEqual(groupByDay([]), []);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test js/timeline.test.js`
Expected: FAIL — cannot find module `./timeline.js` (or `groupByDay` undefined).

- [ ] **Step 3: Implement `groupByDay` in a new `js/timeline.js`**

```js
// timeline.js — filterable, day-grouped activity feed opened from Home.
import { state } from './store.js';
import { fmt, esc, icon, TYPES, sheet } from './ui.js';
import { summary } from './home.js';

const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};

export function groupByDay(entries, now = Date.now()) {
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86400000);
  const buckets = new Map();
  for (const e of entries) {
    const k = dayKey(e.start);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  const keys = [...buckets.keys()].sort().reverse(); // YYYY-MM-DD sorts chronologically
  return keys.map((k) => {
    const items = buckets.get(k).slice().sort((a, b) => new Date(b.start) - new Date(a.start));
    let label;
    if (k === todayKey) label = 'Today';
    else if (k === yesterdayKey) label = 'Yesterday';
    else label = new Date(items[0].start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return { key: k, label, items };
  });
}
```

- [ ] **Step 4: Run the unit test and confirm it passes**

Run: `node --test js/timeline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit (no version bump — `js/timeline.js` is not yet wired into a cached path, but Task 7 ships in the same PR; defer the bump to Task 7)**

```bash
git add js/timeline.js js/timeline.test.js
git commit -m "feat(timeline): add day-grouping helper for the activity feed"
```

---

### Task 7: Timeline view, entry point, filters, and interaction

**Goal:** Render the Timeline as a full sub-view opened from Home, with a multi-select type-filter chip bar (session-only), day-grouped rows reusing `summary()`, tap-to-edit, empty and filtered-empty states, and a back affordance. Five bottom tabs unchanged.

**Files:**
- Modify: `js/timeline.js` (add `timeline()` view + filter state + `toggleFilter`)
- Modify: `js/app.js` (add `timeline` to `VIEWS`, route `nav:timeline` and `timeline:toggle`, import `timeline`)
- Modify: `js/home.js` (point the Today header "Timeline" link at `nav:timeline`)
- Modify: `styles.css` (timeline layout — chip bar, day headers, rows, back button)
- Test: `tests/timeline.test.js` (new Playwright test)

**Interfaces:**
- Consumes: `groupByDay`, `summary(e)` (`{ label, detail, meta, tone, icon }`), `state().log`, `TYPES`, `fmt.rel`.
- Produces: `timeline()` → HTML string rendered by the router; module-level `selectedTypes` Set (empty = show all); `toggleFilter(type)` mutating it.
- Router contract: `current === 'timeline'` is valid; `VIEWS.timeline` exists; no tab is highlighted while open; the 60s `tick()` only refreshes when `current === 'home'`, so the Timeline is safe from clobbering, and `syncOnce()`'s `router.refresh()` re-renders the Timeline in place.

- [ ] **Step 1: Add the view, filter state, and toggle to `js/timeline.js`**

Append to `js/timeline.js`:

```js
// Session-only filter (not persisted). Empty set = show all types.
let selectedTypes = new Set();
export function toggleFilter(type) {
  if (selectedTypes.has(type)) selectedTypes.delete(type);
  else selectedTypes.add(type);
}

const FILTER_TYPES = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath'];

function rowHTML(e) {
  const s = summary(e);
  const detail = [s.detail, s.meta].filter(Boolean).join(' · ');
  return `<div class="tl-row" data-action="entry:edit" data-id="${e.id}">
    <span class="row-ic tone-${s.tone}"><svg class="icon"><use href="#${s.icon}"></use></svg></span>
    <span class="row-txt"><span class="what">${esc(s.label)}</span><span class="when">${esc(detail)}</span></span>
    <span class="meta">${esc(fmt.rel(e.start))}</span>
  </div>`;
}

export function timeline() {
  const all = state().log; // already excludes soft-deleted (mergeById tombstones them)
  const active = selectedTypes;
  const filtered = active.size ? all.filter((e) => active.has(e.type)) : all;
  const groups = groupByDay(filtered);
  const chips = FILTER_TYPES.map((t) => {
    const on = active.has(t);
    return `<button class="tl-chip${on ? ' on' : ''}" data-action="timeline:toggle" data-type="${t}">
      <svg class="icon"><use href="#${icon(TYPES[t].icon)}"></use></svg>${esc(TYPES[t].label)}</button>`;
  }).join('');

  let body;
  if (!all.length) {
    body = `<div class="tl-empty">No entries yet. Log an activity from Home and it'll show up here.</div>`;
  } else if (!filtered.length) {
    body = `<div class="tl-empty">Nothing matches these filters.</div>`;
  } else {
    body = groups.map((g) => `
      <div class="tl-day"><h2 class="tl-day-hd">${esc(g.label)}</h2>
        <div class="card log">${g.items.map(rowHTML).join('')}</div>
      </div>`).join('');
  }

  return `
    <div class="page-hd tl-hd">
      <button class="tl-back" data-action="nav:home" aria-label="Back to Home"><svg class="icon"><use href="#chevron-left"></use></svg></button>
      <h1 class="page-title">Timeline</h1>
    </div>
    <div class="tl-chipbar">${chips}</div>
    ${body}`;
}
```

- [ ] **Step 2: Wire the Timeline into the router in `js/app.js`**

Add the import (extend the `./timeline.js` import — create it):

```js
import { timeline, toggleFilter } from './timeline.js';
```

Add `timeline` to the `VIEWS` map (line 18):

```js
const VIEWS = { home, trends, sleep, growth, profile, timeline };
```

Add two routes to the click `map`:

```js
    'nav:timeline': () => router.go('timeline'),
    'timeline:toggle': () => { toggleFilter(d.type); router.refresh(); },
```

(`router.go('timeline')` works as-is: it sets `current='timeline'`, renders `VIEWS.timeline()`, runs `initThumbs`, sets `scrollTop=0`, and toggles no tab on since none has `data-tab="timeline"`. No enter-animation branch fires.)

- [ ] **Step 3: Point the Home "Timeline" link at the new sub-view**

In `js/home.js` `home()`, the Today header currently reads:

```js
<div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : `<a data-action="nav:sleep">Timeline</a>`}</div>
```

Change the non-edit link's action from `nav:sleep` to `nav:timeline`:

```js
<div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : `<a data-action="nav:timeline">Timeline</a>`}</div>
```

- [ ] **Step 4: Add Timeline styles to `styles.css`**

Append (reuse existing `.card.log`, `.row-ic`, `.row-txt`, `.meta`, tone classes):

```css
/* ---- timeline ---- */
.tl-hd { display: flex; align-items: center; gap: 10px; }
.tl-back { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--hair); color: var(--soft); }
.tl-chipbar { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 12px; -webkit-overflow-scrolling: touch; }
.tl-chip { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 7px 13px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--soft); background: color-mix(in oklch, var(--accent-tint) 60%, transparent); }
.tl-chip .icon { width: 15px; height: 15px; }
.tl-chip.on { color: var(--accent-ink); background: var(--surface); box-shadow: 0 1px 3px var(--mat-cast); }
.tl-day { margin-bottom: 18px; }
.tl-day-hd { font-family: var(--font-sans); font-size: 14px; font-weight: 800; color: var(--soft); margin: 6px 2px 8px; }
.tl-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; cursor: pointer; }
.tl-empty { color: var(--soft); text-align: center; padding: 48px 16px; }
```

(If any custom property above is not defined in the theme, substitute the nearest existing token used by `.row` / `.add-card`; check `:root` in `styles.css` first with `rg "--accent-ink|--accent-tint|--mat-cast|--hair|--surface|--soft" styles.css`.)

- [ ] **Step 5: Write a Playwright test for the Timeline**

Create `tests/timeline.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18794);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    // Log a couple of entries so the timeline has content.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    // Open the timeline from Home.
    await page.click('[data-action="nav:timeline"]');
    await page.waitForSelector('.tl-chipbar');
    check('timeline opens with a chip bar', true);
    const rows = await page.$$('.tl-row');
    check('timeline shows at least one row', rows.length >= 1, 'rows=' + rows.length);
    const hasToday = await page.$$eval('.tl-day-hd', els => els.some(e => e.textContent.trim() === 'Today'));
    check('timeline groups under a Today header', hasToday);
    // Filter to a type with no entries → filtered-empty state.
    await page.click('.tl-chip[data-type="sleep"]');
    await page.waitForSelector('.tl-empty');
    check('filtering to an absent type shows the filtered-empty state', true);
    // Back returns to Home.
    await page.click('.tl-chip[data-type="sleep"]'); // clear filter
    await page.click('.tl-back');
    await page.waitForSelector('.actions');
    check('back returns to Home', true);
  } catch (e) {
    check('timeline test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
```

- [ ] **Step 6: Run the Playwright test and confirm it passes**

Run: `node tests/timeline.test.js`
Expected: `5 pass, 0 fail`.

- [ ] **Step 7: Verify live**

Use `run`. From Home, tap "Timeline". Confirm: reverse-chron day groups with "Today"/"Yesterday"/dated headers; each row shows icon + label + detail + relative time; chip bar toggles types (multi-select); tapping a row opens the edit/delete sheet; empty and filtered-empty messages render; back returns to Home. Confirm the five bottom tabs are unchanged.

- [ ] **Step 8: Run the full suite, bump version, and commit**

```bash
node tests/run.js && npm run check
TS=$(date -u +%Y-%m-%dT%H:%MZ)
# Update index.html + sw.js to $TS / hearth-$TS
git add index.html sw.js js/timeline.js js/app.js js/home.js styles.css tests/timeline.test.js
git commit -m "feat(timeline): add filterable day-grouped activity feed opened from Home"
```

---

## Self-review notes (coverage map)

- 1.1 thumb-on-refresh + clock24 normalize → Task 1.
- 1.2 refined-glass restyle → Task 2.
- 1.3 desktop date autofill (reproduce-first) → Task 3.
- 2.1 bath days-since card → Task 4.
- 2.2 medicine card redesign (empty +, single direct-log, multi picker, edit manages list) → Task 5.
- 3 Timeline (entry point from Home, day groups, summary reuse, tap-to-edit, multi-select session-only filters, empty + filtered-empty, excludes soft-deleted) → Tasks 6–7.
- Out of scope (bath intervals/reminders, persisted filters, sixth tab, accounts) → not implemented. Accounts/OAuth live in `2026-06-27-accounts-and-oauth.md`.
