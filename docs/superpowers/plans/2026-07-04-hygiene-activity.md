# Hygiene Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Hygiene" as a full loggable activity type — a user-configurable list of named items (e.g. "Nail trim", "Brush teeth", "Sunscreen"), each with its own reminder interval — mirroring medicine's structure end-to-end: client state, log form, dose-style shortcut, management sheet, server column, sync, and server-side reminder scheduling.

**Architecture:** Hygiene reuses medicine's exact shape (a settings array of `{ id, name, everyH }` items, a per-item "next due" derivation, a select-dropdown log form, a tap-the-card shortcut that logs the single/next item directly or opens a picker for multiple) but drops the `dose`/`unit` fields medicine has (hygiene items aren't medications). It starts as an opt-in card (like `bath`, not default-shown like `medicine`) since it's new and has no natural default item.

**Tech Stack:** Vanilla JS (`js/store.js`, `js/ui.js`, `js/home.js`, `js/sheets.js`, `js/app.js`, `js/profile.js`), Go (`server/family.go`, `server/sync.go`, `server/push.go`, `server/db.go`, `server/schema.sql`), SQLite, Playwright E2E (`tests/`), Go tests (`server/*_test.go`).

## Global Constraints

- Lucide icons only, vendored as inline `<symbol>` in `index.html`'s sprite.
- Round shape language: pills for controls, big radii for cards.
- Conventional Commits for git messages.
- Bump the version (`scripts/bump-version.sh`) before every commit touching `js/`, `index.html`, or `styles.css`. Go-only commits skip it.
- Add a changelog entry (`js/changelog.js`) under today's date block once client-visible work lands.
- New SQLite columns need BOTH a `schema.sql` definition (fresh DBs) AND an `ALTER TABLE ... ADD COLUMN` guard in `server/db.go` (existing DBs) — this repo has no migration runner, per the established `playtypes_json` precedent at `server/db.go:62`.
- Decided now, not deferred: hygiene items are `{ id, name, everyH }` — no `dose`/`unit` (hygiene activities aren't medications). The hygiene card starts hidden/opt-in (added via the "Add card" picker, like `bath`) rather than default-shown (like `medicine`), since a fresh install has no natural default hygiene item. Hygiene reminders respect quiet hours (like `bottle`), unlike medicine reminders, which intentionally ignore them — hygiene items (nail trims, baths) aren't safety-critical the way medication doses are.

---

### Task 1: Client state model — `store.js`

**Files:**
- Modify: `js/store.js` (`DEFAULT()` at store.js:10-33, `normalizeSettings()` at store.js:56-67, `derive` object — add `nextHygiene()` near `nextMeds()` at store.js:451-458, `derive.reminders()` at store.js:638-644, `enqueueSettingsSync()` at store.js:718-724)
- Test: `js/store.test.js` (existing file — add hygiene cases)

**Interfaces:**
- Produces: `state().settings.hygiene` — an array of `{ id: string, name: string, everyH: number }`. `derive.nextHygiene()` — same shape/contract as `derive.nextMeds()`: returns `[{ item, last, due }, ...]` sorted by soonest due, where `item` is the hygiene settings object, `last` is a `Date` or `null`, `due` is a `Date` or `null`. Log entries of `type: 'hygiene'` carry `itemId` (mirrors medicine's `medId`).

- [ ] **Step 1: Write the failing unit test**

`js/store.test.js` is ESM: it imports `state, derive, addEntry, ...` once at the top of the file (line 19) via `const { state, derive, addEntry, ... } = await import('./store.js');`, then every `test(...)` block below just uses those already-destructured names directly. Add `derive` and `addEntry` to that top-of-file destructuring line if they aren't already present, then append this test (using `test`/`assert` exactly as every other test in the file does — no local `require`):

```js
test('nextHygiene computes per-item due dates like nextMeds', () => {
  state().settings.hygiene = [{ id: 'h1', name: 'Nail trim', everyH: 168 }];
  const before = derive.nextHygiene();
  assert.equal(before[0].last, null);
  assert.equal(before[0].due, null);
  addEntry({ type: 'hygiene', start: new Date().toISOString(), itemId: 'h1', name: 'Nail trim' });
  const after = derive.nextHygiene();
  assert.ok(after[0].last instanceof Date);
  assert.ok(after[0].due instanceof Date);
  assert.equal(after[0].due.getTime() - after[0].last.getTime(), 168 * 60 * 60 * 1000);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `derive.nextHygiene is not a function`.

- [ ] **Step 3: Add the default state, normalization fallback, and `nextHygiene()`**

In `js/store.js`, add `hygiene: []` to the `settings` object in `DEFAULT()` (store.js:10-33), directly after the `meds` array (store.js:17-19):

```js
    meds: [
      { id: 'm1', name: 'Vitamin D', dose: '1', unit: 'drop', everyH: 24 }
    ],
    hygiene: [],
```

In `normalizeSettings()` (store.js:56-67), add a legacy-state fallback directly after the `playTypes` line (store.js:65), matching that exact pattern:

```js
  if (!Array.isArray(s.hygiene)) s.hygiene = [];
```

Add `nextHygiene()` to the `derive` object, directly after `nextMeds()` (store.js:451-458):

```js
  nextHygiene() {
    return _state.settings.hygiene.map((it) => {
      const given = _state.log.filter((e) => e.type === 'hygiene' && e.itemId === it.id);
      const last = given.length ? new Date(given[0].start) : null;
      const due = last ? new Date(last.getTime() + it.everyH * HR) : null;
      return { item: it, last, due };
    }).sort((a, b) => (a.due ? a.due : Infinity) - (b.due ? b.due : Infinity));
  },
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `node --test js/store.test.js`
Expected: PASS.

- [ ] **Step 5: Wire hygiene into the client-side reminder list and sync payload**

In `derive.reminders()` (store.js:638-644), add directly after the `meds` branch (store.js:642):

```js
  if (r.hygiene) { derive.nextHygiene().forEach((h) => { if (h.due) out.push({ key: 'hyg-' + h.item.id, title: h.item.name + ' due', body: h.item.name + ' is due now.', at: h.due.getTime() }); }); }
```

In `enqueueSettingsSync()` (store.js:718-724), add `hygiene: s.hygiene` to the `body` object:

```js
export function enqueueSettingsSync() {
  const s = _state.settings;
  enqueue({
    url: '/api/settings', method: 'PATCH',
    body: { bottleIntervalH: s.bottleIntervalH, meds: s.meds, hygiene: s.hygiene, units: s.units, reminders: s.reminders, cards: s.cards, playTypes: s.playTypes }
  });
}
```

No change is needed to `applySyncResponse()` (store.js:703-712) — it already does `Object.assign(_state.settings, resp.settings)`, which picks up a `hygiene` key automatically once the server includes it (Task 6).

Also add `hygiene: true` to the default `reminders` object in `DEFAULT()` (store.js:22), directly after `meds: true`:

```js
    reminders: { naps: true, bottle: true, meds: true, hygiene: true, lead: 0, quietStart: '20:00', quietEnd: '07:00' },
```

- [ ] **Step 6: Commit**

```bash
scripts/bump-version.sh
git add js/store.js js/store.test.js
git commit -m "$(cat <<'EOF'
feat(store): add hygiene item state and per-item due-date derivation

EOF
)"
```

---

### Task 2: Icon, TYPES registry entry, and tone color

**Files:**
- Modify: `index.html` (sprite `<symbol>` block)
- Modify: `js/ui.js` (`TYPES` object, ui.js:49-59)
- Modify: `styles.css` (tone color rules, near styles.css:74-81 and the dark-mode overrides near styles.css:537-544)

**Interfaces:**
- Produces: sprite id `icon-hygiene`; `TYPES.hygiene = { icon: 'icon-hygiene', label: 'Hygiene', tone: 'hygiene' }`; CSS classes `.hygiene`/`.tone-hygiene`.

- [ ] **Step 1: Vendor the icon**

In `index.html`, add directly after the existing sprite symbols (e.g. right after `icon-bath`'s `<symbol>`):

```html
<symbol id="icon-hygiene" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  <path d="M20 3v4" />
  <path d="M22 5h-4" />
  <path d="M4 17v2" />
  <path d="M5 18H3" />
</symbol>
```

- [ ] **Step 2: Add the `TYPES` entry**

In `js/ui.js`, add to `TYPES` (ui.js:49-59), directly after `bath`:

```js
  hygiene:  { icon: 'icon-hygiene', label: 'Hygiene', tone: 'hygiene' },
```

- [ ] **Step 3: Add the tone color**

In `styles.css`, add directly after the `.bath,.tone-bath` rule (styles.css:81):

```css
.hygiene,.tone-hygiene { --tc: oklch(0.50 0.08 195); --tcb: oklch(0.90 0.04 198); }
```

And directly after the dark-mode `.bath`/`.tone-bath` override (styles.css:538):

```css
[data-mode="dark"] .hygiene, [data-mode="dark"] .tone-hygiene { --tc: oklch(0.72 0.09 195); --tcb: oklch(0.26 0.05 195); }
```

- [ ] **Step 4: Visually verify**

Use the `run` skill to start the dev server; in a browser console, run `document.querySelector('#icon-hygiene')` and confirm it returns the element (not `null`), and confirm no console errors.

- [ ] **Step 5: Commit**

```bash
scripts/bump-version.sh
git add index.html js/ui.js styles.css
git commit -m "$(cat <<'EOF'
feat(ui): add hygiene icon, type registry entry, and tone color

EOF
)"
```

---

### Task 3: Log form, gather/prefill, and Today-row summary

**Files:**
- Modify: `js/sheets.js` (`FORMS` object at sheets.js:447-489, `gather()` at sheets.js:491-525, `prefill()` at sheets.js:581-598)
- Modify: `js/home.js` (`summary()` at home.js:8-36)

**Interfaces:**
- Consumes: `state().settings.hygiene` from Task 1.
- Produces: `FORMS.hygiene()`, and `gather()`/`prefill()` handling for `type === 'hygiene'` producing/restoring `{ itemId, name }` on the log entry (mirrors medicine's `{ medId, name, dose }` minus dose).

- [ ] **Step 1: Add `FORMS.hygiene`**

In `js/sheets.js`, add to `FORMS` (sheets.js:447-489), directly after `bath`:

```js
  hygiene: () => {
    const items = state().settings.hygiene;
    if (!items.length) return `<p class="empty-note">No hygiene items yet. Add one from the Hygiene card on Home.</p>`;
    return `
    ${field('Item', `<select id="f-hyg">${items.map((it) => `<option value="${it.id}">${esc(it.name)}</option>`).join('')}</select>`)}
    ${timeRow()} ${noteRow()}`;
  },
```

- [ ] **Step 2: Update `gather()`**

In `js/sheets.js`, add to `gather()` (sheets.js:491-525), directly after the `medicine` branch (sheets.js:517-520):

```js
  } else if (type === 'hygiene') {
    const id = $('#f-hyg').value;
    const it = state().settings.hygiene.find((x) => x.id === id);
    base.itemId = id; base.name = it.name;
  }
```

- [ ] **Step 3: Update `prefill()`**

In `js/sheets.js`, add to `prefill()` (sheets.js:581-598), directly after the `medicine` branch (sheets.js:596):

```js
  else if (type === 'hygiene') { if ($('#f-hyg')) $('#f-hyg').value = e.itemId; }
```

- [ ] **Step 4: Add a Today-row summary branch**

In `js/home.js`, add to `summary()` (home.js:8-36), directly after the `medicine` branch (home.js:23-24):

```js
  } else if (e.type === 'hygiene') {
    label = e.name || 'Hygiene'; detail = fmt.clock(e.start); meta = e.note || '';
```

- [ ] **Step 5: Manual verification**

This form isn't reachable from the UI yet (no card, no type-chooser entry, no action wiring — that's Task 4). Skip live verification until Task 4 lands; the code added here is inert but must not throw on import. Run `node --check js/sheets.js js/home.js` to confirm no syntax errors.

- [ ] **Step 6: Commit**

```bash
scripts/bump-version.sh
git add js/sheets.js js/home.js
git commit -m "$(cat <<'EOF'
feat(sheets): add the hygiene log form, gather/prefill, and summary row

EOF
)"
```

---

### Task 4: Management sheet, dose-style shortcut, home card, and action wiring

**Files:**
- Modify: `js/sheets.js` (`editCard()` at sheets.js:661-687, `pickCard()` at sheets.js:704-723, `openTypeChooser()` at sheets.js:620-631, add `hygieneForm()`/`hygieneRow()`/`saveHygiene()`/`logHygieneItem()`/`openHygieneCard()` near the medicine equivalents at sheets.js:634-770)
- Modify: `js/app.js` (imports at app.js:13, action map near app.js:224-228, add `addHygieneItem()` near `addMed()` at app.js:540-545)
- Modify: `js/home.js` (add `hygieneCard()` near `medicineCard()` at home.js:284-308, `refreshOverdueLabels()` at home.js:326-353, `CARD_KEYS`/`CARD_RENDER`/`CARD_TYPES` at home.js:378-381, `QUICK` at home.js:403-406)

**Interfaces:**
- Consumes: `state().settings.hygiene`, `derive.nextHygiene()` from Task 1; `FORMS.hygiene`/`gather`/`prefill` from Task 3.
- Produces: `data-action="hygiene:log"`, `"hygiene:card"`, `"hygiene:add"`, `"hygiene:remove"`, `"card:save-hygiene"` — all wired in `app.js`. `hygieneCard()` renders `data-card="hygiene"`.

- [ ] **Step 1: Add the dose-style shortcut and card-tap dispatcher**

In `js/sheets.js`, add directly after `openMedCard()` (sheets.js:646-658):

```js
// ---------- hygiene card logging ----------
export function logHygieneItem(itemId) {
  const it = state().settings.hygiene.find((x) => x.id === itemId);
  if (!it) return;
  const e = { type: 'hygiene', start: new Date().toISOString(), itemId: it.id, name: it.name };
  const added = addEntry(e);
  sheet.close();
  if (state().settings.sound !== false) { chime(); buzz(15); }
  confetti();
  toast(it.name + ' logged', () => { removeEntry(added.id); router.refresh(); });
  router.refresh();
}

export function openHygieneCard() {
  const items = state().settings.hygiene;
  if (!items.length) { editCard('hygiene'); return; }
  if (items.length === 1) { logHygieneItem(items[0].id); return; }
  sheet.open(
    `<div class="chooser">` + items.map((it) => `
      <button class="chooser-item" data-action="hygiene:log" data-hid="${it.id}">
        <span class="chooser-ic tone-hygiene"><svg class="icon"><use href="#icon-hygiene"></use></svg></span>
        <span>${esc(it.name)}</span>
      </button>`).join('') + `</div>`,
    { title: 'Log hygiene' }
  );
}
```

- [ ] **Step 2: Add the management sheet**

In `js/sheets.js`, add directly after `medRow()` (sheets.js:759-770):

```js
function hygieneForm() {
  const items = state().settings.hygiene;
  return `<div id="hygiene-list" class="med-list">` +
    (items.length ? items.map(hygieneRow).join('') : `<p class="empty-note">No hygiene items yet.</p>`) +
    `</div>
    <button class="btn-ghost" data-action="hygiene:add"><svg class="icon"><use href="#plus"></use></svg> Add item</button>
    <button class="btn-primary" data-action="card:save-hygiene"><svg class="icon"><use href="#check"></use></svg> Save</button>
    <button class="btn-ghost" data-action="card:hide" data-card="hygiene">Hide this card</button>`;
}
export function hygieneRow(it) {
  return `<div class="med-edit" data-hid="${it.id}">
    <input class="hyg-name" placeholder="Name" value="${esc(it.name)}" />
    <div class="med-sub">
      <span class="med-every">every</span>
      <input class="hyg-eh" type="number" min="1" max="720" value="${it.everyH}" /><span class="med-every">h</span>
      <button class="med-del" data-action="hygiene:remove" data-hid="${it.id}" aria-label="Remove"><svg class="icon"><use href="#trash-2"></use></svg></button>
    </div>
  </div>`;
}
```

Reuses the existing `.med-list`/`.med-edit`/`.med-sub`/`.med-every`/`.med-del` CSS classes from medicine's form — no new CSS needed, since the layout is identical minus the dose/unit inputs.

- [ ] **Step 3: Add `saveHygiene()`**

In `js/sheets.js`, add directly after `saveMeds()` (sheets.js:801-811):

```js
export function saveHygiene() {
  const rows = $$('#hygiene-list .med-edit');
  state().settings.hygiene = rows.map((r) => ({
    id: r.dataset.hid,
    name: $('.hyg-name', r).value.trim() || 'Hygiene',
    everyH: Number($('.hyg-eh', r).value) || 168
  }));
  save(); enqueueSettingsSync(); sheet.close(); toast('Hygiene items updated'); router.refresh();
}
```

- [ ] **Step 4: Wire `editCard()`, `pickCard()`, and `openTypeChooser()`**

In `js/sheets.js`'s `editCard()` (sheets.js:661-687), add directly after the `bath` branch:

```js
  } else if (which === 'hygiene') {
    sheet.open(hygieneForm(), { title: 'Hygiene items', size: 'sheet-form' });
```

In `pickCard()` (sheets.js:704-723), change the condition and add a hygiene case mirroring `bath`'s order-push:

```js
export function pickCard(type) {
  if (type === 'bottle' || type === 'medicine' || type === 'bath' || type === 'hygiene') {
    if (type === 'bath' || type === 'hygiene') {
      const cards = state().settings.cards;
      cards.order = cards.order || ['bottle', 'medicine'];
      if (!cards.order.includes(type)) cards.order.push(type);
      cards[type] = true;
      save(); enqueueSettingsSync(); sheet.close(); toast((TYPES[type] || {}).label + ' card added'); router.refresh();
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

(This generalizes the existing `bath`-only branch to cover both `bath` and `hygiene`, since they now share the identical "push to order + toast the label" logic; the toast text changes from a hardcoded `'Bath card added'` to the label-driven string, which still reads correctly for bath: `'Bath card added'`.)

In `openTypeChooser()` (sheets.js:620-631), add `'hygiene'` to the `types` array:

```js
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath', 'hygiene'];
```

- [ ] **Step 5: Add the home card**

In `js/home.js`, add directly after `medicineCard()` (home.js:284-308):

```js
function hygieneCard() {
  const items = derive.nextHygiene();
  const next = items.find((h) => h.due) || items[0];
  const action = cardEditMode ? '' : 'data-action="hygiene:card"';
  if (!next) {
    return `<div class="info-card" ${action} data-card="hygiene">
      <div class="ic-ring hygiene"><svg class="icon"><use href="#plus"></use></svg></div>
      <div class="ic-txt"><div class="ic-lbl">Hygiene</div><div class="ic-val">Add a hygiene item</div></div>
      ${icEdit('hygiene')}
    </div>`;
  }
  let val, lbl;
  if (!next.due) { lbl = next.item.name + ' · every ' + next.item.everyH + 'h'; val = 'Not done yet'; }
  else {
    lbl = next.item.name;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${fmt.untilOrAgo(next.due)}</span>`;
  }
  const overdue = next.due && next.due <= new Date();
  const top = overdue ? `Hygiene due · ${fmt.untilOrAgo(next.due)}` : 'Next hygiene';
  return `<div class="info-card ${overdue ? 'due' : ''}" ${action} data-card="hygiene">
    <div class="ic-ring hygiene"><svg class="icon"><use href="#icon-hygiene"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">${top}</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('hygiene')}
  </div>`;
}
```

Add a `hygiene` branch to `refreshOverdueLabels()` (home.js:326-353), directly after the `medicine` branch:

```js
    } else if (type === 'hygiene') {
      const items = derive.nextHygiene();
      const next = items.find((h) => h.due) || items[0];
      if (!next || !next.due) return;
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `Hygiene due · ${fmt.untilOrAgo(next.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(next.due);
```

Update the card registries (home.js:378-381):

```js
const CARD_KEYS = ['bottle', 'medicine'];
const CARD_RENDER = { bottle: bottleCard, medicine: medicineCard, bath: bathCard, hygiene: hygieneCard };
export const CARD_TYPES = ['feed', 'bottle', 'diaper', 'medicine', 'play', 'bath', 'pump', 'hygiene'];
```

`CARD_KEYS` stays `['bottle', 'medicine']` — hygiene is opt-in, same as `bath` (not part of the default order), per the Global Constraints decision.

Add `{ t: 'hygiene' }` to `QUICK` (home.js:403-406):

```js
const QUICK = [
  { t: 'sleep', primary: true }, { t: 'feed' }, { t: 'bottle' }, { t: 'diaper' },
  { t: 'medicine' }, { t: 'play' }, { t: 'bath' }, { t: 'hygiene' }
];
```

- [ ] **Step 6: Wire the actions in `app.js`**

In `js/app.js`, update the `sheets.js` import (app.js:13) to add the new exports:

```js
import { openLog, saveLog, openTypeChooser, editCard, saveBottle, saveMeds, hideCard, showCard, openMeasure, saveMeasure, medRow, openSpinner, openCardPicker, pickCard, saveNewCard, saveCardInterval, removeCard, openMedCard, logMedDose, openPlayTypes, savePlayTypes, playTypeRow, syncDiaperSizeVisibility, saveHygiene, logHygieneItem, openHygieneCard, hygieneRow } from './sheets.js';
```

Add to the action map, directly after the `med:remove` entry (app.js:228):

```js
    'card:save-hygiene': () => saveHygiene(),
    'hygiene:add': () => addHygieneItem(),
    'hygiene:card': () => openHygieneCard(),
    'hygiene:log': () => logHygieneItem(d.hid),
    'hygiene:remove': () => { const r = $(`.med-edit[data-hid="${d.hid}"]`); if (r) r.remove(); },
```

Add `addHygieneItem()` directly after `addMed()` (app.js:540-545):

```js
function addHygieneItem() {
  const list = $('#hygiene-list'); if (!list) return;
  const empty = $('.empty-note', list); if (empty) empty.remove();
  const id = 'h' + Date.now().toString(36);
  list.insertAdjacentHTML('beforeend', hygieneRow({ id, name: '', everyH: 168 }));
}
```

- [ ] **Step 7: Manual verification**

Use the `run` skill to start the dev server. From Home, tap "Add card" → "Hygiene" → confirm the card appears showing "Add a hygiene item". Tap the card → confirm it opens the management sheet (since the list is empty). Add an item named "Nail trim" with interval 168, save → confirm the card now reads "Next hygiene" / "Not done yet" / "Nail trim · every 168h". Tap the card again → confirm it logs directly (single item) with a toast and confetti. Add a second item, tap the card → confirm a picker sheet appears instead. Log via "More" → "Hygiene" too, confirming the select-dropdown form works and the entry appears in Today's log with the item's name.

- [ ] **Step 8: Commit**

```bash
scripts/bump-version.sh
git add js/sheets.js js/app.js js/home.js
git commit -m "$(cat <<'EOF'
feat(hygiene): add management sheet, log shortcut, home card, and action wiring

EOF
)"
```

---

### Task 5: Reminders settings toggle in Profile

**Files:**
- Modify: `js/profile.js` (reminders section, near profile.js:88)

- [ ] **Step 1: Add the toggle row**

In `js/profile.js`, add directly after the "Medicine reminders" row (profile.js:88):

```js
      <div class="set-row"><span>Hygiene reminders</span>${sw('settings.reminders.hygiene', s.reminders.hygiene)}</div>
```

- [ ] **Step 2: Manual verification**

Use the `run` skill to start the dev server, open Profile → Reminders, confirm "Hygiene reminders" appears and toggling it persists (reopen Profile and check the switch state survived).

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add js/profile.js
git commit -m "$(cat <<'EOF'
feat(profile): add a hygiene reminders toggle

EOF
)"
```

---

### Task 6: Server schema, migration, and settings sync

**Files:**
- Modify: `server/schema.sql` (`settings` table, schema.sql:49-59)
- Modify: `server/db.go` (migration guards, db.go:46-64)
- Modify: `server/family.go` (`defaultRemindersJSON`/`defaultCardsJSON` constants at family.go:10-14, `patchSettingsRequest` at family.go:147-154, `handlePatchSettings` UPDATE at family.go:187-188)
- Modify: `server/sync.go` (settings SELECT+marshal at sync.go:64-79)
- Test: `server/settings_test.go` (add a hygiene-specific case mirroring `TestHandlePatchSettingsUpdatesPlayTypes`)

**Interfaces:**
- Produces: SQLite column `settings.hygiene_json` (`NOT NULL DEFAULT '[]'`), `patchSettingsRequest.Hygiene json.RawMessage`, sync response key `"hygiene"`.

- [ ] **Step 1: Write the failing Go test**

Add to `server/settings_test.go`, directly after `TestHandlePatchSettingsUpdatesPlayTypes` (settings_test.go:80-100):

```go
func TestHandlePatchSettingsUpdatesHygiene(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	body := `{"bottleIntervalH":3,"meds":[],"hygiene":[{"id":"h1","name":"Nail trim","everyH":168}],"units":{},"reminders":{},"cards":{},"playTypes":[]}`
	req := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchSettings(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var hygieneJSON string
	db.QueryRow(`SELECT hygiene_json FROM settings WHERE family_id = 'fam1'`).Scan(&hygieneJSON)
	if hygieneJSON != `[{"id":"h1","name":"Nail trim","everyH":168}]` {
		t.Errorf("hygiene_json = %q, want [{\"id\":\"h1\",\"name\":\"Nail trim\",\"everyH\":168}]", hygieneJSON)
	}
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `go test ./server -run TestHandlePatchSettingsUpdatesHygiene -v`
Expected: FAIL — `no such column: hygiene_json` (or `patchSettingsRequest` field decode is silently ignored, then the `SELECT hygiene_json` fails since the column doesn't exist yet).

- [ ] **Step 3: Add the column to `schema.sql`**

In `server/schema.sql`, add to the `settings` table (schema.sql:49-59), directly after `meds_json`:

```sql
  hygiene_json TEXT NOT NULL DEFAULT '[]',
```

- [ ] **Step 4: Add the migration guard to `db.go`**

In `server/db.go`, add directly after the `playtypes_json` `ALTER TABLE` guard (db.go:62-64):

```go
	if _, err := db.Exec(`ALTER TABLE settings ADD COLUMN hygiene_json TEXT NOT NULL DEFAULT '[]'`); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return nil, err
	}
```

- [ ] **Step 5: Wire the PATCH handler**

In `server/family.go`, add to `patchSettingsRequest` (family.go:147-154), directly after `Meds`:

```go
	Hygiene         json.RawMessage `json:"hygiene"`
```

Update the `UPDATE` statement in `handlePatchSettings` (family.go:187-188):

```go
		res, err := tx.Exec(`UPDATE settings SET bottle_interval_h = ?, meds_json = ?, hygiene_json = ?, units_json = ?, reminders_json = ?, cards_json = ?, playtypes_json = ?, updated_at = ?, rev = ? WHERE family_id = ?`,
			req.BottleIntervalH, rawOrNull(req.Meds), rawOrNull(req.Hygiene), rawOrNull(req.Units), rawOrNull(req.Reminders), rawOrNull(req.Cards), rawOrNull(req.PlayTypes), now, rev, session.FamilyID)
```

Also update `defaultRemindersJSON` (family.go:12) to include the hygiene toggle, matching the client default set in Task 1:

```go
	defaultRemindersJSON = `{"naps":true,"bottle":true,"meds":true,"hygiene":true,"quietStart":"20:00","quietEnd":"07:00"}`
```

(`defaultCardsJSON`, family.go:13, is left unchanged — hygiene is opt-in, not a default-shown card, per the Global Constraints decision, so it must NOT appear in `defaultCardsJSON`.)

- [ ] **Step 6: Wire the sync response**

In `server/sync.go`, update the settings SELECT+marshal block (sync.go:64-79):

```go
		var bottleIntervalH float64
		var medsJSON, hygieneJSON, unitsJSON, remindersJSON, cardsJSON, playTypesJSON string
		var settingsRev int64
		err = tx.QueryRow(`SELECT bottle_interval_h, meds_json, hygiene_json, units_json, reminders_json, cards_json, playtypes_json, rev FROM settings WHERE family_id = ?`, session.FamilyID).
			Scan(&bottleIntervalH, &medsJSON, &hygieneJSON, &unitsJSON, &remindersJSON, &cardsJSON, &playTypesJSON, &settingsRev)
		if err == nil && settingsRev > since {
			s, _ := json.Marshal(map[string]any{
				"bottleIntervalH": bottleIntervalH,
				"meds":            json.RawMessage(medsJSON),
				"hygiene":         json.RawMessage(hygieneJSON),
				"units":           json.RawMessage(unitsJSON),
				"reminders":       json.RawMessage(remindersJSON),
				"cards":           json.RawMessage(cardsJSON),
				"playTypes":       json.RawMessage(playTypesJSON),
			})
			resp.Settings = s
		}
```

- [ ] **Step 7: Run the test again to confirm it passes**

Run: `go test ./server -run TestHandlePatchSettingsUpdatesHygiene -v`
Expected: PASS.

- [ ] **Step 8: Run the full Go suite to confirm no regressions**

Run: `go test ./server`
Expected: all PASS (existing meds/playTypes tests unaffected — they don't reference `hygiene_json`, and the new column's `DEFAULT '[]'` means their `INSERT`/`UPDATE` statements that omit it still work).

- [ ] **Step 9: Commit**

```bash
git add server/schema.sql server/db.go server/family.go server/sync.go server/settings_test.go
git commit -m "$(cat <<'EOF'
feat(server): add hygiene_json settings column and sync round-trip

EOF
)"
```

---

### Task 7: Server-side hygiene reminders

**Files:**
- Modify: `server/push.go` (`reminderSettings` struct at push.go:54-63, `defaultReminderSettings()` at push.go:61-63, `familyReminders()` at push.go:279-319)
- Test: `server/push_test.go` (add cases mirroring `TestFamilyRemindersIncludesMedDuringQuietHours` and `TestFamilyRemindersHonorsBottleDisabledAndQuietHours`)

**Interfaces:**
- Produces: `reminderSettings.Hygiene bool`; `familyReminders()` appends `pushReminder{Key: "hyg-<id>", ...}` entries, each respecting quiet hours (unlike medicine's).

- [ ] **Step 1: Write the failing Go tests**

Add to `server/push_test.go`, directly after `TestFamilyRemindersIncludesMedDuringQuietHours` (push_test.go:171-201):

```go
func TestFamilyRemindersIncludesHygieneOutsideQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, hygiene_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"h1","name":"Nail trim","everyH":1}]`,
		`{"bottle":false,"meds":false,"hygiene":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('hyg1', 'fam1', 'hygiene', ?, '{"itemId":"h1"}', 'cg1', ?)`,
		time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var found bool
	for _, r := range reminders {
		if r.Key == "hyg-h1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a hygiene reminder, got %+v", reminders)
	}
}

func TestFamilyRemindersSkipsHygieneDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, hygiene_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', ?, '{}', ?, '{}', ?)`,
		"fam1",
		`[{"id":"h1","name":"Nail trim","everyH":1}]`,
		`{"bottle":false,"meds":false,"hygiene":true,"quietStart":"00:00","quietEnd":"23:59"}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('hyg1', 'fam1', 'hygiene', ?, '{"itemId":"h1"}', 'cg1', ?)`,
		time.Now().UTC().Add(-2*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "hyg-h1" {
			t.Fatalf("hygiene reminder should be suppressed during quiet hours (00:00-23:59 is always quiet), got %+v", r)
		}
	}
}
```

- [ ] **Step 2: Run to confirm both fail**

Run: `go test ./server -run TestFamilyRemindersIncludesHygieneOutsideQuietHours -v` and `go test ./server -run TestFamilyRemindersSkipsHygieneDuringQuietHours -v`
Expected: both FAIL — `no such column: hygiene_json` (Task 6 already added the column; if Task 6 landed first this instead fails because `reminderSettings.Hygiene` doesn't exist yet / no `hyg-` reminders are ever produced).

- [ ] **Step 3: Add the `Hygiene` field and default**

In `server/push.go`, update `reminderSettings` (push.go:54-63):

```go
type reminderSettings struct {
	Bottle     bool   `json:"bottle"`
	Meds       bool   `json:"meds"`
	Hygiene    bool   `json:"hygiene"`
	QuietStart string `json:"quietStart"`
	QuietEnd   string `json:"quietEnd"`
}

func defaultReminderSettings() reminderSettings {
	return reminderSettings{Bottle: true, Meds: true, Hygiene: true, QuietStart: "20:00", QuietEnd: "07:00"}
}
```

- [ ] **Step 4: Add the hygiene loop to `familyReminders()`**

In `server/push.go`, update `familyReminders()` (push.go:279-319) — add `hygieneJSON` to the scanned columns and append a hygiene loop after the `meds` block:

```go
func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON, hygieneJSON, remindersJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json, hygiene_json, reminders_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON, &hygieneJSON, &remindersJSON); err != nil {
		return nil, err
	}
	settings := parseReminderSettings(remindersJSON)
	reminders := []pushReminder{}
	if settings.Bottle {
		var lastBottle string
		if err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle); err == nil {
			if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
				at := t.Add(time.Duration(bottleInterval * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at})
				}
			}
		}
	}
	if settings.Meds {
		var meds []struct {
			ID     string  `json:"id"`
			Name   string  `json:"name"`
			Dose   string  `json:"dose"`
			Unit   string  `json:"unit"`
			EveryH float64 `json:"everyH"`
		}
		json.Unmarshal([]byte(medsJSON), &meds)
		for _, med := range meds {
			var lastMed string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'medicine' AND json_extract(payload_json, '$.medId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, med.ID).Scan(&lastMed)
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
				reminders = append(reminders, pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: t.Add(time.Duration(med.EveryH * float64(time.Hour)))})
			}
		}
	}
	if settings.Hygiene {
		var items []struct {
			ID     string  `json:"id"`
			Name   string  `json:"name"`
			EveryH float64 `json:"everyH"`
		}
		json.Unmarshal([]byte(hygieneJSON), &items)
		for _, it := range items {
			var last string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'hygiene' AND json_extract(payload_json, '$.itemId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, it.ID).Scan(&last)
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, last); err == nil {
				at := t.Add(time.Duration(it.EveryH * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					reminders = append(reminders, pushReminder{Key: "hyg-" + it.ID, Title: it.Name + " due", Body: it.Name + " is due now.", At: at})
				}
			}
		}
	}
	return reminders, nil
}
```

- [ ] **Step 5: Run the tests again to confirm they pass**

Run: `go test ./server -run TestFamilyRemindersIncludesHygieneOutsideQuietHours -v` and `go test ./server -run TestFamilyRemindersSkipsHygieneDuringQuietHours -v`
Expected: both PASS.

- [ ] **Step 6: Run the full Go suite**

Run: `go test ./server`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/push.go server/push_test.go
git commit -m "$(cat <<'EOF'
feat(push): schedule per-item hygiene reminders, honoring quiet hours

EOF
)"
```

---

### Task 8: End-to-end client test

**Files:**
- Create: `tests/hygienecard.test.js` (mirrors `tests/medcard.test.js` exactly, adapted for hygiene's action names)

**Interfaces:**
- Consumes: `startServer`, `launchBrowser`, `onboard`, `check`, `tally` from `./helpers`.

- [ ] **Step 1: Write the test**

Create `tests/hygienecard.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18804);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Hygiene isn't a default card: add it first.
    await page.click('[data-action="card:add"]');
    await page.waitForSelector('[data-action="card:pick"][data-type="hygiene"]');
    await page.click('[data-action="card:pick"][data-type="hygiene"]');
    await page.waitForSelector('[data-card="hygiene"]');
    check('hygiene card appears after adding it', true);

    // Empty state: tapping the card opens the management sheet.
    await page.click('[data-action="hygiene:card"]');
    await page.waitForSelector('#hygiene-list', { timeout: 3000 });
    check('empty hygiene card opens the management sheet', true);

    // Add one item.
    await page.click('[data-action="hygiene:add"]');
    await page.fill('#hygiene-list .med-edit:last-child .hyg-name', 'Nail trim');
    await page.click('[data-action="card:save-hygiene"]');
    await page.waitForTimeout(300);

    // Single item: tapping the card logs directly.
    await page.click('[data-action="hygiene:card"]');
    await page.waitForTimeout(400);
    const toast1 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('single hygiene item logs directly with toast', toast1);

    const savedName = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'hygiene');
      return e ? e.name : undefined;
    });
    check('hygiene entry saves the item name', savedName === 'Nail trim', savedName);

    // Add a second item to test the multi-item picker.
    await page.click('[data-action="card:edit"][data-card="hygiene"]');
    await page.waitForSelector('#hygiene-list', { timeout: 3000 });
    await page.click('[data-action="hygiene:add"]');
    await page.fill('#hygiene-list .med-edit:last-child .hyg-name', 'Brush teeth');
    await page.click('[data-action="card:save-hygiene"]');
    await page.waitForTimeout(300);

    await page.click('[data-action="hygiene:card"]');
    await page.waitForSelector('[data-action="hygiene:log"]', { timeout: 3000 });
    check('multi-item hygiene card shows a picker', true);

    await page.click('[data-action="hygiene:log"]');
    await page.waitForTimeout(300);
    const toast2 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('picking a hygiene item logs with a toast', toast2);

    // Also reachable via the "More" type chooser.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('[data-action="log:open"][data-type="hygiene"]', { timeout: 3000 });
    check('hygiene appears in the "More" type chooser', true);
  } catch (e) {
    check('hygiene card test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `CHROMIUM=/usr/bin/chromium node tests/hygienecard.test.js`
Expected: all `check()` lines pass, process exits 0.

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add tests/hygienecard.test.js
git commit -m "$(cat <<'EOF'
test(hygiene): cover the add-card, log, and picker flows end-to-end

EOF
)"
```

---

### Task 9: Changelog entry

**Files:**
- Modify: `js/changelog.js` (today's date block)

- [ ] **Step 1: Add the changelog line**

Add to the `features` array of today's block:

```js
'Added a Hygiene card — track custom items like nail trims or brushing teeth, each with its own reminder interval. Add it from "Add card" on Home.'
```

- [ ] **Step 2: Run the changelog test**

Run: `CHROMIUM=/usr/bin/chromium node tests/changelog.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add js/changelog.js
git commit -m "$(cat <<'EOF'
docs: add changelog entry for the hygiene activity type

EOF
)"
```

---

## Self-Review Notes

- Spec coverage: settings list entry ✓ (Task 1/4, `state().settings.hygiene`), per-item interval ✓ (`everyH`, Task 1), `TYPES` registry entry ✓ (Task 2), form + dose-shortcut + management sheet ✓ (Tasks 3-4, `FORMS.hygiene`/`logHygieneItem`/`hygieneForm`), server column + sync payload ✓ (Task 6), server-side reminder scheduling ✓ (Task 7). All ~11 medicine touchpoints are mirrored: client default state, normalization, derivation, client-side reminders list, sync payload, TYPES entry, log form, gather/prefill, Today-row summary, management sheet + dose shortcut + home card, action wiring, server schema + migration + PATCH handler + sync response + push scheduler.
- Decided (not deferred): no dose/unit fields (not medication), opt-in card like `bath` rather than default-shown like `medicine`, quiet-hours respected (unlike medicine) since these aren't safety-critical reminders.
- This plan does not touch the generic `nextForType`/`genericCard` path at all — hygiene needs medicine's bespoke multi-item structure, per the triage decision, not the single-interval generic path already used by user-added simple types.
