# Sleep Detail Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Huckleberry-style optional sleep detail fields (start mood, time-to-fall-asleep, how-it-happened, end-of-sleep state) to the sleep log form, collapsed under a "Details — Optional" section, all nullable and non-breaking to existing sleep entries.

**Architecture:** Four new nullable fields on the sleep log entry (`startMood`, `fallAsleep`, `method`, `endMood`), gathered/prefilled the same way `quality` already is today. Three fields reuse the existing text-only segmented control (`seg()`); the ninth-option `method` field needs icons per option, which the existing sliding-thumb `segctl` can't lay out in a wrapped grid, so it gets a new non-animated icon-grid control instead. Everything lives inside a native `<details>` element so the core sleep form stays fast by default.

**Tech Stack:** Vanilla JS (`js/sheets.js`, `js/app.js`, `js/ui.js`), CSS (`styles.css`), inline Lucide SVG sprite (`index.html`), Playwright E2E test (`tests/`).

## Global Constraints

- Lucide icons only, vendored as inline `<symbol>` in `index.html`'s sprite — never load external icon fonts.
- Round shape language: pills for controls, big radii for cards.
- One ambient animation concept at a time — the new icon-grid control must NOT get a sliding thumb or other ambient animation; it's a static toggle grid.
- Follow Conventional Commits for git messages.
- Bump the version (`scripts/bump-version.sh`) before every commit that touches `js/`, `index.html`, or `styles.css`.
- Add a changelog entry (`js/changelog.js`) under today's date block, in the `features` array, in plain parent-facing language.
- All new fields must be optional/nullable — never required, matching how `quality` already isn't required today.

---

### Task 1: Vendor the new Lucide icons for the "how it happened" grid

**Files:**
- Modify: `index.html` (sprite `<symbol>` block, alongside the existing icons starting around line 41)

**Interfaces:**
- Produces: six new sprite ids — `bed-single`, `bed-double`, `users`, `car`, `footprints`, `wind` — usable anywhere via `icon('bed-single')` etc. (`icon-bottle`, `milk`, and `user` are already vendored and reused as-is.)

**Icon-to-option mapping for the 9-option "how it happened" field (decided now, not at implementation time):**

| Option | Icon id |
|---|---|
| On own in bed | `bed-single` |
| Nursing | `milk` (already vendored) |
| Worn or held | `user` (already vendored) |
| Next to carer | `users` |
| Co-sleep | `bed-double` |
| Bottle | `icon-bottle` (already vendored) |
| Stroller | `footprints` |
| Car | `car` |
| Swing | `wind` |

- [ ] **Step 1: Add the six new `<symbol>` entries to the sprite**

Open `index.html` and find the existing sprite block (search for `<symbol id="user"`). Add these six symbols directly after it, matching the file's existing format (`fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`):

```html
<symbol id="bed-single" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
  <path d="M3 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4" />
  <path d="M3 18h18" />
</symbol>
<symbol id="bed-double" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
  <path d="M4 10V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4" />
  <path d="M12 10V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4" />
  <path d="M2 18h20" />
</symbol>
<symbol id="users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
  <circle cx="9" cy="7" r="4" />
  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
</symbol>
<symbol id="car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
  <circle cx="7" cy="17" r="2" />
  <path d="M9 17h6" />
  <circle cx="17" cy="17" r="2" />
</symbol>
<symbol id="footprints" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
  <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
  <path d="M16 17h4" />
  <path d="M4 13h4" />
</symbol>
<symbol id="wind" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
  <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
  <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
</symbol>
```

- [ ] **Step 2: Visually verify the sprite parses**

Use the `run` skill to start the dev server, then in a browser console on any page run:

```js
document.querySelectorAll('#bed-single, #bed-double, #users, #car, #footprints, #wind').length
```

Expected: `6`. Also confirm no console errors on page load (a malformed `<symbol>` breaks the whole inline sprite).

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add index.html
git commit -m "$(cat <<'EOF'
feat(icons): vendor bed-single, bed-double, users, car, footprints, wind

EOF
)"
```

---

### Task 2: Add the icon-grid control primitive

**Files:**
- Modify: `js/sheets.js` (add `iconGrid()` helper near the existing `seg()` helper, sheets.js:8-14)
- Modify: `js/app.js` (add `icongrid:pick` to the action map, near `form:toggle` at app.js:281)
- Modify: `styles.css` (add `.icongrid` / `.icongrid-opt` rules near the existing `.segctl` rules, styles.css:792)
- Test: `js/sheets.test.js` (new file — first unit test for `sheets.js`; `sheets.js` doesn't export `iconGrid` today, so export it for testability)

**Interfaces:**
- Consumes: `esc()` from `js/ui.js` (already imported in `sheets.js`).
- Produces: `iconGrid(group, opts, sel)` in `sheets.js`, where `opts` is `[{ val, icon, label }, ...]` and `sel` is the initially-selected `val` (or `null`). Later tasks (Task 3) call this to render the "how it happened" field. Also produces the `data-icongrid="<group>"` container attribute and `.icongrid-opt` buttons with `data-val`, consumed by a new `setIconGrid(group, val)` prefill helper (Task 3) and by the `icongrid:pick` action.

- [ ] **Step 1: Write the failing unit test**

Create `js/sheets.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { iconGrid } from './sheets.js';

test('iconGrid renders one button per option with the right icon and selected state', () => {
  const html = iconGrid('method', [
    { val: 'Nursing', icon: 'milk', label: 'Nursing' },
    { val: 'Car', icon: 'car', label: 'Car' }
  ], 'Car');
  assert.match(html, /data-icongrid="method"/);
  assert.match(html, /data-val="Nursing"/);
  assert.match(html, /href="#milk"/);
  assert.match(html, /data-val="Car"[^>]*class="icongrid-opt on"|class="icongrid-opt on"[^>]*data-val="Car"/);
});

test('iconGrid HTML-escapes option values', () => {
  const html = iconGrid('method', [{ val: '<x>', icon: 'car', label: '<y>' }], null);
  assert.ok(!html.includes('<x>'));
  assert.ok(!html.includes('<y>'));
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test js/sheets.test.js`
Expected: FAIL — `iconGrid` is not exported from `sheets.js` (`SyntaxError` or `undefined is not a function`).

- [ ] **Step 3: Implement `iconGrid()` in `sheets.js`**

In `js/sheets.js`, add directly after the existing `seg()` function (sheets.js:8-14):

```js
export function iconGrid(group, opts, sel) {
  return `<div class="icongrid" data-icongrid="${group}">` +
    opts.map((o) => `<button type="button" class="icongrid-opt ${o.val === sel ? 'on' : ''}" data-val="${esc(o.val)}">` +
      `<svg class="icon"><use href="#${o.icon}"></use></svg><span>${esc(o.label)}</span></button>`).join('') +
    `</div>`;
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `node --test js/sheets.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the CSS**

In `styles.css`, add directly after the `.segctl` rule block (after the `[data-mode="dark"] .seg-opt.on` rule, around styles.css:840):

```css
.icongrid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
}
.icongrid-opt {
  all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 6px; border-radius: 14px; text-align: center;
  font-size: 11px; font-weight: 700; color: var(--soft);
  background: color-mix(in oklch, var(--accent-tint) 55%, transparent);
  transition: color .15s, background .15s;
}
.icongrid-opt .icon { width: 20px; height: 20px; }
.icongrid-opt.on { color: var(--accent-ink); background: var(--accent-tint); }
[data-mode="dark"] .icongrid-opt { background: oklch(0.26 0.022 48 / 0.45); }
[data-mode="dark"] .icongrid-opt.on { color: var(--accent); background: oklch(0.30 0.030 48); }
```

- [ ] **Step 6: Wire the click action in `app.js`**

In `js/app.js`, add directly after the `'form:toggle'` entry (app.js:281):

```js
    'icongrid:pick': () => {
      const g = el.closest('[data-icongrid]');
      if (!g) return;
      $$('.icongrid-opt', g).forEach((o) => o.classList.toggle('on', o === el));
    },
```

Then add `data-action="icongrid:pick"` to every `.icongrid-opt` button. Update the `iconGrid()` template from Step 3 to include it:

```js
export function iconGrid(group, opts, sel) {
  return `<div class="icongrid" data-icongrid="${group}">` +
    opts.map((o) => `<button type="button" class="icongrid-opt ${o.val === sel ? 'on' : ''}" data-val="${esc(o.val)}" data-action="icongrid:pick">` +
      `<svg class="icon"><use href="#${o.icon}"></use></svg><span>${esc(o.label)}</span></button>`).join('') +
    `</div>`;
}
```

Re-run `node --test js/sheets.test.js` — still PASS (the added attribute doesn't affect the existing assertions).

- [ ] **Step 7: Commit**

```bash
scripts/bump-version.sh
git add js/sheets.js js/sheets.test.js js/app.js styles.css
git commit -m "$(cat <<'EOF'
feat(sheets): add a static icon-grid control primitive

EOF
)"
```

---

### Task 3: Add the four detail fields to the sleep form, gather/prefill, and the collapsible section

**Files:**
- Modify: `js/sheets.js` (`FORMS.sleep`, sheets.js:448-452; `gather()`, sheets.js:497-500; `prefill()`, sheets.js:584; add `setSeg`-style helper for icon-grid)
- Modify: `styles.css` (style the `<details>`/`<summary>` wrapper)

**Interfaces:**
- Consumes: `iconGrid(group, opts, sel)` and `.icongrid-opt` markup from Task 2; existing `seg()`, `segVal()`, `field()`, `setSeg()` from `sheets.js`.
- Produces: sleep log entries gain four new nullable string fields — `startMood`, `fallAsleep`, `method`, `endMood` — read by `gather()` and written by `prefill()`. Later tasks/tests read these exact field names.

- [ ] **Step 1: Add the fields to `FORMS.sleep`**

In `js/sheets.js`, replace the `sleep` entry in `FORMS` (sheets.js:448-452):

```js
  sleep: () => `
    ${field('Fell asleep', dtPair('f-time', nowLocalDT()))}
    ${field('Woke (leave blank if still asleep)', dtPair('f-end', ''))}
    ${field('Quality', seg('quality', ['Restless', 'Okay', 'Good', 'Great'], 'Good'))}
    ${noteRow()}
    <details class="sleep-details">
      <summary>Details — Optional</summary>
      ${field('Mood at bedtime', seg('startMood', ['Upset', 'Content'], null))}
      ${field('Time to fall asleep', seg('fallAsleep', ['Under 10 min', '10-20 min', 'Long time to fall asleep'], null))}
      ${field('How it happened', iconGrid('method', [
        { val: 'On own in bed', icon: 'bed-single', label: 'On own' },
        { val: 'Nursing', icon: 'milk', label: 'Nursing' },
        { val: 'Worn or held', icon: 'user', label: 'Held' },
        { val: 'Next to carer', icon: 'users', label: 'Next to carer' },
        { val: 'Co-sleep', icon: 'bed-double', label: 'Co-sleep' },
        { val: 'Bottle', icon: 'icon-bottle', label: 'Bottle' },
        { val: 'Stroller', icon: 'footprints', label: 'Stroller' },
        { val: 'Car', icon: 'car', label: 'Car' },
        { val: 'Swing', icon: 'wind', label: 'Swing' }
      ], null))}
      ${field('How sleep ended', seg('endMood', ['Woke up child', 'Upset', 'Content'], null))}
    </details>`,
```

Note: `seg()` (sheets.js:9-14) already tolerates `sel === null` — no option gets the `on` class, matching how these fields start unset. This is the same nullable pattern `quality`/`side`/`contents` never actually use today (they always default one option "on"), but it's supported by the existing code with no changes needed.

- [ ] **Step 2: Add a `setIconGrid` prefill helper**

In `js/sheets.js`, directly after `setSeg()` (sheets.js:570-573):

```js
function setIconGrid(group, val) {
  const g = $(`[data-icongrid="${group}"]`); if (!g) return;
  $$('.icongrid-opt', g).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
```

- [ ] **Step 3: Update `gather()` to read the four new fields**

In `js/sheets.js`, change the `sleep` branch of `gather()` (sheets.js:497-500):

```js
  if (type === 'sleep') {
    base.quality = segVal('quality');
    const endLocal = readDT('f-end');
    base.end = endLocal ? dtToISO(endLocal) : null;
    base.startMood = segVal('startMood');
    base.fallAsleep = segVal('fallAsleep');
    const m = $('[data-icongrid="method"] .icongrid-opt.on');
    base.method = m ? m.dataset.val : null;
    base.endMood = segVal('endMood');
  }
```

- [ ] **Step 4: Update `prefill()` to restore the four new fields**

In `js/sheets.js`, change the `sleep` branch of `prefill()` (sheets.js:584):

```js
  if (type === 'sleep') {
    setSeg('quality', e.quality); if (e.end) writeDT('f-end', e.end);
    setSeg('startMood', e.startMood); setSeg('fallAsleep', e.fallAsleep);
    setIconGrid('method', e.method); setSeg('endMood', e.endMood);
  }
```

- [ ] **Step 5: Style the `<details>` wrapper**

In `styles.css`, add directly after the `.icongrid`/`.icongrid-opt` rules added in Task 2:

```css
.sleep-details { display: flex; flex-direction: column; gap: 13px; }
.sleep-details summary {
  cursor: pointer; font-size: 12px; font-weight: 700; color: var(--soft);
  list-style: none; padding: 4px 0;
}
.sleep-details summary::-webkit-details-marker { display: none; }
.sleep-details summary::before { content: '▸ '; }
.sleep-details[open] summary::before { content: '▾ '; }
```

- [ ] **Step 6: Manual verification**

Use the `run` skill to start the dev server. Open the sleep log sheet, expand "Details — Optional", select one option in each of the four new fields, save, reopen the entry for edit, and confirm all four selections are restored. Then collapse a selection back to none (there's no "clear" affordance yet by design — the seg/icon-grid controls are additive-only, matching how `quality` etc. behave today) and confirm saving with all four still unset doesn't throw.

- [ ] **Step 7: Commit**

```bash
scripts/bump-version.sh
git add js/sheets.js styles.css
git commit -m "$(cat <<'EOF'
feat(sleep): add optional bedtime mood, time-to-fall-asleep, method, and end-state fields

EOF
)"
```

---

### Task 4: E2E test for the new sleep detail fields

**Files:**
- Create: `tests/sleep-details.test.js` (follows the exact pattern of `tests/diaper-rash.test.js`)

**Interfaces:**
- Consumes: `startServer`, `launchBrowser`, `onboard`, `check`, `tally` from `./helpers` (same as every other file in `tests/`).

- [ ] **Step 1: Write the E2E test**

Create `tests/sleep-details.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18803);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // A fresh sleep form's details start collapsed and unselected.
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('.sleep-details');
    const startsClosed = await page.$eval('.sleep-details', (el) => !el.open);
    check('sleep details section starts collapsed', startsClosed);

    // Expand and pick one option in each new field.
    await page.click('.sleep-details summary');
    await page.click('[data-seg="startMood"] [data-val="Content"]');
    await page.click('[data-seg="fallAsleep"] [data-val="Under 10 min"]');
    await page.click('[data-icongrid="method"] [data-val="Nursing"]');
    await page.click('[data-seg="endMood"] [data-val="Content"]');
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'sleep');
      return e ? { startMood: e.startMood, fallAsleep: e.fallAsleep, method: e.method, endMood: e.endMood } : null;
    });
    check('sleep entry saves startMood: Content', saved && saved.startMood === 'Content', saved);
    check('sleep entry saves fallAsleep: Under 10 min', saved && saved.fallAsleep === 'Under 10 min', saved);
    check('sleep entry saves method: Nursing', saved && saved.method === 'Nursing', saved);
    check('sleep entry saves endMood: Content', saved && saved.endMood === 'Content', saved);

    // Reopen for edit: all four selections must be restored.
    const entryId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'sleep').id;
    });
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('.sleep-details');
    const startMoodOn = await page.$eval('[data-seg="startMood"] [data-val="Content"]', (el) => el.classList.contains('on'));
    const methodOn = await page.$eval('[data-icongrid="method"] [data-val="Nursing"]', (el) => el.classList.contains('on'));
    check('editing a sleep entry restores startMood selection', startMoodOn);
    check('editing a sleep entry restores method selection', methodOn);

    // A sleep entry with no details set at all must save cleanly (fields stay null).
    await page.click('[data-action="sheet:close"]');
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('.sleep-details');
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);
    const secondSaved = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.filter((x) => x.type === 'sleep').length;
    });
    check('a sleep entry with no optional details saves without throwing', secondSaved === 2, secondSaved);
  } catch (e) {
    check('sleep details test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `CHROMIUM=/usr/bin/chromium node tests/sleep-details.test.js`
Expected: all `check()` lines print as passes, process exits 0.

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add tests/sleep-details.test.js
git commit -m "$(cat <<'EOF'
test(sleep): cover the new optional detail fields end-to-end

EOF
)"
```

---

### Task 5: Changelog entry

**Files:**
- Modify: `js/changelog.js` (today's date block — check `CHANGELOG[0].date`; if it isn't today, add a new block at the top per the project's changelog rule)

- [ ] **Step 1: Add the changelog line**

Add to the `features` array of today's block:

```js
'Added optional sleep details — bedtime mood, time to fall asleep, how it happened, and how sleep ended — tap "Details — Optional" on the sleep log sheet.'
```

- [ ] **Step 2: Run the changelog test**

Run: `node --test js/*.test.js 2>&1 | tail -20` and `node tests/changelog.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
scripts/bump-version.sh
git add js/changelog.js
git commit -m "$(cat <<'EOF'
docs: add changelog entry for optional sleep detail fields

EOF
)"
```

---

## Self-Review Notes

- Spec coverage: start mood ✓ (Task 3, `startMood` seg), time-to-fall-asleep ✓ (`fallAsleep` seg), how-it-happened with icons ✓ (Task 2 + 3, `iconGrid`), end-of-sleep state ✓ (`endMood` seg), collapsible "Details — Optional" ✓ (Task 3, native `<details>`), all fields optional/nullable ✓ (no default `sel`, `gather()` always writes `null` when unset).
- Decided (not deferred): kept the existing `quality` field as-is rather than folding it into `startMood`, since Huckleberry's mood field and Hearth's existing quality field measure different things (bedtime mood vs. overall sleep quality) and removing `quality` would be a breaking, unrequested scope change.
- Sizing: this plan does not add a "reminders" or "hygiene" touchpoint — those are separate dogfood items with their own plans.
