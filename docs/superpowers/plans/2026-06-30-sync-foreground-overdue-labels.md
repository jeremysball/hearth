# Sync Foreground Catch-Up and Overdue Reminder Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the partner's device pull missed entries on foreground, and keep overdue Home card labels live without a full re-render.

**Architecture:** Add a `visibilitychange` listener that calls `syncOnce` and reconnects a stale SSE connection when the page returns to the foreground; shorten the passive poll from 30s to 15s. Render overdue bottle/medicine/generic card labels as "X due · Nh ago" instead of "Next X · every Nh", and add a 15s tick that updates only the `.ic-lbl` and `.ic-rel` text nodes of already-overdue cards by re-reading derive values — no full re-render.

**Tech Stack:** Vanilla ES modules, Playwright (with Clock API for time-dependent tests), Node test runner.

## Global Constraints

- No framework. Vanilla JS PWA.
- Run `scripts/bump-version.sh` before each commit that touches `js/`, `index.html`, or `sw.js`. Never hand-edit the version strings.
- Conventional Commits: `fix(scope): description` or `feat(scope): description`.
- Playwright tests spin up the Go server on a unique port and use `require('./helpers')` for `startServer`, `launchBrowser`, `onboard`, `check`, `tally`.
- Run `npm run check` (node --check + eslint) before committing if you change JS.
- All three tasks modify `js/` files, so every commit needs a version bump.

---

## File Structure

- Modify `js/home.js`: `bottleCard`, `medicineCard`, `genericCard` overdue label branches; new `refreshOverdueLabels` export.
- Modify `js/app.js`: import `refreshOverdueLabels`; add 15s overdue-label tick; add `visibilitychange` listener; shorten passive poll from 30s to 15s.
- Create `tests/overdue-labels.test.js`: Playwright suite covering overdue label rendering and the 15s live tick.
- Create `tests/visibility-sync.test.js`: Playwright suite covering the `visibilitychange` → `syncOnce` wiring.
- Modify `index.html` and `sw.js`: version bump via `scripts/bump-version.sh` (every commit).

---

### Task 1: Overdue card labels

When a card's due moment has passed, the `.ic-lbl` text should read "Bottle due · 2h ago" (or "Medicine due", "Play due", etc.) instead of the static "Next bottle · every 3h". The `.ic-rel` span already shows the relative time via `fmt.untilOrAgo` — this task changes only the `.ic-lbl` line and adds the `due` class to the medicine card when overdue.

**Files:**
- Modify: `js/home.js` — `bottleCard` (line 255), `medicineCard` (line 267), `genericCard` (line 292)
- Create: `tests/overdue-labels.test.js`
- Modify: `index.html`, `sw.js` (via `scripts/bump-version.sh`)

**Interfaces:**
- Consumes: `derive.nextBottle()` → `{ last: Date, due: Date }`; `derive.nextMeds()` → `[{ med, last: Date|null, due: Date|null }]` sorted by due ascending; `derive.nextForType(type)` → `{ last, due: Date, intervalH: number }`; `fmt.untilOrAgo(d)` → `"in Xh"` / `"Xh ago"` / `"now"`; `TYPES[type]` → `{ icon, label, tone }`; `state().settings.bottleIntervalH` → number.
- Produces: `bottleCard`, `medicineCard`, `genericCard` render overdue `.ic-lbl` text and (for medicine) the `due` class on `.info-card`. No new exports in this task.

- [ ] **Step 1: Write the failing test**

Create `tests/overdue-labels.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18798);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Install the clock before navigation so every setInterval/setTimeout the
    // app creates is mocked and drivable via fastForward.
    await page.clock.install({ time: new Date('2026-06-30T08:00:00Z') });
    await page.goto(srv.base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await onboard(page);
    await page.waitForSelector('[data-card="bottle"]');

    // Log a bottle at the current (mocked) time. The form defaults to 120ml
    // and "Formula" — no spinner interaction needed, the save button picks
    // up the data-value attribute the stepper renders with.
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="log:save"]');
    await page.waitForTimeout(600);

    // Pre-overdue: label reads "Next bottle · every 3h".
    const freshLbl = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    check('fresh bottle shows "Next bottle · every 3h"', freshLbl === 'Next bottle · every 3h', freshLbl);

    // Jump 4h ahead. Bottle interval is 3h → overdue by 1h. fastForward fires
    // each mocked timer at most once; the 60s tick fires → router.refresh →
    // the overdue label renders.
    await page.clock.fastForward(4 * 3600 * 1000);
    await page.waitForTimeout(400);

    const overdueLbl = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    check('overdue bottle shows "Bottle due · 1h ago"', overdueLbl === 'Bottle due · 1h ago', overdueLbl);

    // Medicine card: Vitamin D (24h, never given → due = null → not overdue).
    const medLbl = await page.$eval('[data-card="medicine"] .ic-lbl', el => el.textContent.trim());
    check('never-given medicine still shows "Next medicine"', medLbl === 'Next medicine', medLbl);
  } catch (e) {
    check('overdue-labels test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/overdue-labels.test.js`
Expected: FAIL on `'overdue bottle shows "Bottle due · 1h ago"'` — the label still reads `"Next bottle · every 3h"` because the render functions have not been changed yet. The "fresh bottle" and "never-given medicine" checks should PASS (they assert current behavior).

- [ ] **Step 3: Update `bottleCard` to show overdue label**

In `js/home.js`, replace the `bottleCard` function (lines 255–266):

```js
function bottleCard() {
  const nb = derive.nextBottle();
  const overdue = nb.due < new Date();
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bottle" data-card="bottle">
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Next bottle · every ${state().settings.bottleIntervalH}h</div>
      <div class="ic-val">${fmt.clock(nb.due)} <span class="ic-rel">${fmt.untilOrAgo(nb.due)}</span></div>
    </div>
    ${icEdit('bottle')}
  </div>`;
}
```

with:

```js
function bottleCard() {
  const nb = derive.nextBottle();
  const overdue = nb.due <= new Date();
  const lbl = overdue ? `Bottle due · ${fmt.untilOrAgo(nb.due)}` : `Next bottle · every ${state().settings.bottleIntervalH}h`;
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="bottle" data-card="bottle">
    <div class="ic-ring feed"><svg class="icon"><use href="#${icon('baby-bottle')}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">${lbl}</div>
      <div class="ic-val">${fmt.clock(nb.due)} <span class="ic-rel">${fmt.untilOrAgo(nb.due)}</span></div>
    </div>
    ${icEdit('bottle')}
  </div>`;
}
```

- [ ] **Step 4: Update `medicineCard` to show overdue label and `due` class**

In `js/home.js`, replace the `medicineCard` function (lines 267–289):

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
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${fmt.untilOrAgo(next.due)}</span>`;
  }
  return `<div class="info-card" ${action} data-card="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">Next medicine</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('medicine')}
  </div>`;
}
```

with:

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
    lbl = next.med.name + ' · ' + next.med.dose + next.med.unit;
    val = `${fmt.clock(next.due)} <span class="ic-rel">${fmt.untilOrAgo(next.due)}</span>`;
  }
  const overdue = next.due && next.due <= new Date();
  const top = overdue ? `Medicine due · ${fmt.untilOrAgo(next.due)}` : 'Next medicine';
  return `<div class="info-card ${overdue ? 'due' : ''}" ${action} data-card="medicine">
    <div class="ic-ring med"><svg class="icon"><use href="#${icon('pill')}"></use></svg></div>
    <div class="ic-txt"><div class="ic-lbl">${top}</div><div class="ic-val">${val}</div><div class="ic-lbl2">${esc(lbl)}</div></div>
    ${icEdit('medicine')}
  </div>`;
}
```

Note: `next.due && next.due <= new Date()` guards against `next.due` being `null` (never-given meds). `null && ...` short-circuits to `false`, so the "Not given yet" state never gets the `due` class.

- [ ] **Step 5: Update `genericCard` to show overdue label**

In `js/home.js`, replace the `genericCard` function (lines 292–304):

```js
function genericCard(type) {
  const c = TYPES[type] || { label: type, tone: 'note', icon: 'note-pencil' };
  const n = derive.nextForType(type);
  const overdue = n.due < new Date();
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="${type}" data-card="${type}">
    <div class="ic-ring tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">Next ${esc(c.label.toLowerCase())} · every ${n.intervalH}h</div>
      <div class="ic-val">${fmt.clock(n.due)} <span class="ic-rel">${fmt.untilOrAgo(n.due)}</span></div>
    </div>
    ${icEdit(type)}
  </div>`;
}
```

with:

```js
function genericCard(type) {
  const c = TYPES[type] || { label: type, tone: 'note', icon: 'note-pencil' };
  const n = derive.nextForType(type);
  const overdue = n.due <= new Date();
  const lbl = overdue ? `${esc(c.label)} due · ${fmt.untilOrAgo(n.due)}` : `Next ${esc(c.label.toLowerCase())} · every ${n.intervalH}h`;
  return `<div class="info-card ${overdue ? 'due' : ''}" ${cardEditMode ? '' : 'data-action="log:open"'} data-type="${type}" data-card="${type}">
    <div class="ic-ring tone-${c.tone}"><svg class="icon"><use href="#${icon(c.icon)}"></use></svg></div>
    <div class="ic-txt">
      <div class="ic-lbl">${lbl}</div>
      <div class="ic-val">${fmt.clock(n.due)} <span class="ic-rel">${fmt.untilOrAgo(n.due)}</span></div>
    </div>
    ${icEdit(type)}
  </div>`;
}
```

Note: `TYPES` labels are capitalized ("Play", "Bath", "Pump"), so the overdue form reads "Play due · 1h ago". The non-overdue form keeps the lowercased "Next play · every 3h".

- [ ] **Step 6: Run test to verify it passes**

Run: `node tests/overdue-labels.test.js`
Expected: PASS — all three checks pass:
- `fresh bottle shows "Next bottle · every 3h"`
- `overdue bottle shows "Bottle due · 1h ago"`
- `never-given medicine still shows "Next medicine"`

- [ ] **Step 7: Run lint check**

Run: `npm run check`
Expected: PASS — no errors in `js/home.js`.

- [ ] **Step 8: Bump version and commit**

```bash
./scripts/bump-version.sh
git add js/home.js tests/overdue-labels.test.js index.html sw.js
git commit -m "fix(home): show overdue label on bottle, medicine, and generic cards"
```

---

### Task 2: Live 15s tick for overdue labels

The 60s `tick` in `app.js` calls `router.refresh()` (full re-render) which updates the overdue label every 60s at most. This task adds a 15s interval that calls a new `refreshOverdueLabels()` export from `home.js`, which updates only the `.ic-lbl` and `.ic-rel` text nodes of cards that already have the `due` class — no full re-render, no DOM thrash.

**Files:**
- Modify: `js/home.js` — add `refreshOverdueLabels` export (after `genericCard`, around line 304)
- Modify: `js/app.js` — line 6 (import), after line 562 (15s interval)
- Modify: `tests/overdue-labels.test.js` — add tick assertions
- Modify: `index.html`, `sw.js` (via `scripts/bump-version.sh`)

**Interfaces:**
- Consumes: Task 1's overdue `.ic-lbl` rendering and the `due` class on `.info-card` elements. `derive.nextBottle()`, `derive.nextMeds()`, `derive.nextForType(type)`, `fmt.untilOrAgo(d)`, `TYPES[type]`.
- Produces: `refreshOverdueLabels()` exported from `js/home.js` — no arguments, no return value. Queries `document.querySelectorAll('.info-card.due')` and updates `.ic-lbl` / `.ic-rel` textContent for each. Called from `js/app.js` on a 15s interval when `current === 'home'` and no sheet is open.

- [ ] **Step 1: Write the failing test**

Add the following block to `tests/overdue-labels.test.js`, inserted AFTER the `check('never-given medicine still shows "Next medicine"', ...)` line and BEFORE the `} catch (e) {` line:

```js

    // ---- Live 15s tick ----
    // Mark the bottle card's .ic-lbl node with a probe attribute. The 15s
    // tick (refreshOverdueLabels) updates textContent in place, preserving
    // the node. The 60s tick (router.refresh) replaces #view innerHTML,
    // destroying the node and the probe. So if the probe survives the 45s
    // fastForward, no full re-render happened.
    await page.$eval('[data-card="bottle"] .ic-lbl', el => { el.dataset.probe = 'survives'; });
    const beforeTick = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    // fastForward 45s: the 15s interval fires once (next fire ~15s out from
    // the prior 4h jump); the 60s interval does NOT fire (next fire ~60s
    // out, beyond the 45s window). Only refreshOverdueLabels runs.
    await page.clock.fastForward(45 * 1000);
    await page.waitForTimeout(400);
    const afterTick = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    const probeSurvived = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.dataset.probe === 'survives').catch(() => false);
    check('15s tick advances overdue label', afterTick === 'Bottle due · 1h 1m ago' && afterTick !== beforeTick, `${beforeTick} → ${afterTick}`);
    check('15s tick does not full-re-render (node identity preserved)', probeSurvived, probeSurvived ? 'preserved' : 'node replaced');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/overdue-labels.test.js`
Expected: FAIL on `'15s tick advances overdue label'` and `'15s tick does not full-re-render'` — no 15s interval exists yet, so `fastForward(45s)` fires no timer that updates the label (`afterTick` still equals `"Bottle due · 1h ago"`). The three Task 1 checks should still PASS.

Note: at this stage the `dataset.probe` assertion also fails because no tick ran to update the node — but the probe was set on the existing node and `fastForward` doesn't destroy it, so `probeSurvived` is actually `true` here. The failure that matters is the label-advance check. The probe check becomes meaningful in Step 6 where the 15s tick runs instead of the 60s tick.

- [ ] **Step 3: Add `refreshOverdueLabels` export to `home.js`**

In `js/home.js`, immediately after the closing `}` of `genericCard` (the function edited in Task 1 Step 5), insert:

```js

export function refreshOverdueLabels() {
  const cards = document.querySelectorAll('.info-card.due');
  cards.forEach((card) => {
    const type = card.dataset.type || card.dataset.card;
    if (type === 'bottle') {
      const nb = derive.nextBottle();
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `Bottle due · ${fmt.untilOrAgo(nb.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(nb.due);
    } else if (type === 'medicine') {
      const meds = derive.nextMeds();
      const next = meds.find((m) => m.due) || meds[0];
      if (!next || !next.due) return;
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `Medicine due · ${fmt.untilOrAgo(next.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(next.due);
    } else {
      const n = derive.nextForType(type);
      const c = TYPES[type] || { label: type };
      const lbl = card.querySelector('.ic-lbl');
      const rel = card.querySelector('.ic-rel');
      if (lbl) lbl.textContent = `${c.label} due · ${fmt.untilOrAgo(n.due)}`;
      if (rel) rel.textContent = fmt.untilOrAgo(n.due);
    }
  });
}
```

This queries only cards with the `due` class (set during the last full render by Task 1's code). Cards that newly become overdue between ticks are not handled here — they get the `due` class and overdue label on the next 60s `tick` → `router.refresh()`. The 15s tick keeps the elapsed-time text fresh on cards already showing as overdue.

- [ ] **Step 4: Import `refreshOverdueLabels` in `app.js`**

In `js/app.js`, change line 6 from:

```js
import { home, summary, enterTodayEditMode, exitTodayEditMode, enterCardEditMode, exitCardEditMode } from './home.js';
```

to:

```js
import { home, summary, enterTodayEditMode, exitTodayEditMode, enterCardEditMode, exitCardEditMode, refreshOverdueLabels } from './home.js';
```

- [ ] **Step 5: Add the 15s overdue-label tick in `app.js`**

In `js/app.js`, immediately after the `setInterval(tick, 60000);` line (line 562), insert:

```js
setInterval(() => {
  if (current === 'home' && $('#view') && !$('#scrim.show')) refreshOverdueLabels();
}, 15000);
```

This mirrors the guard conditions of `tick()` (line 559–561): only refresh when on the home view with no sheet open.

- [ ] **Step 6: Run test to verify it passes**

Run: `node tests/overdue-labels.test.js`
Expected: PASS — all five checks pass:
- `fresh bottle shows "Next bottle · every 3h"`
- `overdue bottle shows "Bottle due · 1h ago"`
- `never-given medicine still shows "Next medicine"`
- `15s tick advances overdue label` (`"Bottle due · 1h ago"` → `"Bottle due · 1h 1m ago"`)
- `15s tick does not full-re-render (node identity preserved)` — the `dataset.probe` set before the 45s fastForward survives, proving `refreshOverdueLabels` updated textContent in place rather than `router.refresh` recreating the node.

- [ ] **Step 7: Run lint check**

Run: `npm run check`
Expected: PASS — no errors in `js/home.js` or `js/app.js`.

- [ ] **Step 8: Bump version and commit**

```bash
./scripts/bump-version.sh
git add js/home.js js/app.js tests/overdue-labels.test.js index.html sw.js
git commit -m "feat(home): live 15s tick refreshes overdue card labels"
```

---

### Task 3: visibilitychange sync and shorter poll

When the partner foregrounds the app, nothing triggers a pull until the next passive poll tick. iOS also drops `EventSource` sockets in the background; the missed SSE broadcast is never replayed. Add a `visibilitychange` listener that calls `syncOnce` and reconnects a stale SSE connection on foreground. Also shorten the passive poll from 30s to 15s so the catch-up window is smaller even without a visibility event.

**Files:**
- Modify: `js/app.js` — after line 673 (`window.addEventListener('online', syncOnce)`), change line 674 (`setInterval(syncOnce, 30000)` → `15000`)
- Create: `tests/visibility-sync.test.js`
- Modify: `index.html`, `sw.js` (via `scripts/bump-version.sh`)

**Interfaces:**
- Consumes: `syncOnce()` (async, defined at `js/app.js:644`), `connectEvents()` (defined at `js/app.js:664`), `eventSource` (module-level variable at `js/app.js:663`).
- Produces: a `visibilitychange` listener on `document` that calls `syncOnce()` and reconnects SSE if stale. No new exports.

- [ ] **Step 1: Write the failing test**

Create `tests/visibility-sync.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Track /api/sync requests from the very start so we can compare
    // against a baseline taken after the initial sync settles. Match on
    // pathname so the counter is robust to query-string changes.
    let syncHits = 0;
    page.on('request', (req) => {
      try {
        if (new URL(req.url()).pathname === '/api/sync') syncHits++;
      } catch {}
    });

    await page.goto(srv.base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await onboard(page);
    // Let the initial sync + SSE connection settle. 2s is well under the
    // 15s passive poll, so no interval-driven sync fires in this window.
    await page.waitForTimeout(2000);
    const baseline = syncHits;

    // Dispatch a synthetic visibilitychange. The page is already visible,
    // so the listener's guard passes and syncOnce fires.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(2000);

    check('visibilitychange triggers syncOnce', syncHits > baseline, `${syncHits - baseline} sync requests after foreground (baseline ${baseline})`);
  } catch (e) {
    check('visibility-sync test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/visibility-sync.test.js`
Expected: FAIL on `'visibilitychange triggers syncOnce'` — `syncHits - baseline` is `0` because no `visibilitychange` listener is registered, so dispatching the event does nothing.

- [ ] **Step 3: Add the `visibilitychange` listener and shorten the poll**

In `js/app.js`, find the sync loop section (lines 673–675):

```js
window.addEventListener('online', syncOnce);
setInterval(syncOnce, 30000);
setSyncTrigger(() => { drainOutbox(); syncOnce(); });
```

Replace with:

```js
window.addEventListener('online', syncOnce);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncOnce();
  if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
    eventSource?.close();
    eventSource = null;
    connectEvents();
  }
});
setInterval(syncOnce, 15000);
setSyncTrigger(() => { drainOutbox(); syncOnce(); });
```

The listener runs only when the page becomes visible. It pulls missed entries immediately, then checks whether the SSE socket is dead (closed by iOS in the background, or errored out) and reconnects if so. `eventSource?.close()` is a no-op when `eventSource` is already `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/visibility-sync.test.js`
Expected: PASS — `visibilitychange triggers syncOnce` passes (at least 1 sync request after foreground).

- [ ] **Step 5: Run both new test suites together**

Run: `node tests/overdue-labels.test.js && node tests/visibility-sync.test.js`
Expected: Both PASS — confirms the two test suites don't interfere (they use different ports: 18798 and 18799).

- [ ] **Step 6: Run lint check**

Run: `npm run check`
Expected: PASS — no errors in `js/app.js`.

- [ ] **Step 7: Bump version and commit**

```bash
./scripts/bump-version.sh
git add js/app.js tests/visibility-sync.test.js index.html sw.js
git commit -m "fix(sync): pull on visibilitychange and reconnect stale SSE"
```

---

### Task 4: Full suite verification and push

Confirm nothing else broke. The three changes touch `js/home.js` and `js/app.js`, which are broad enough to warrant the full Playwright suite per the CLAUDE.md rules.

**Files:** None modified — verification only.

- [ ] **Step 1: Run the full Playwright suite**

Run: `CHROMIUM=/usr/bin/chromium npm test`
Expected: All suites PASS (or any failures are pre-existing and confirmed unchanged). The two new suites (`overdue-labels.test.js`, `visibility-sync.test.js`) must PASS.

- [ ] **Step 2: Run Go tests (unchanged server code, but confirm)**

Run: `cd server && go test ./...`
Expected: PASS — no server code was changed, but confirm the build is clean.

- [ ] **Step 3: Verify no uncommitted version drift**

Run: `git diff --name-only HEAD`
Expected: clean working tree (all changes committed in Tasks 1–3).

- [ ] **Step 4: Push**

```bash
git push origin main
```

Per the CLAUDE.md rules: push immediately after every commit to `main`. Never leave `main` ahead of `origin/main`.

---

## Manual Verification (not automated)

These scenarios from the spec require a real device or are flaky to automate. Confirm by hand after the suite passes:

1. **visibilitychange SSE reconnect:** With the app open and SSE connected, toggle the device network off then on. Dispatch a foreground (switch tabs and return). Confirm `/api/events` reconnects — watch the server logs or the browser Network tab for a new EventSource connection.
2. **Overdue label on a real timer:** Log a bottle, wait past the 3h interval with the app open. Confirm the card label changes from "Next bottle · every 3h" to "Bottle due · X min ago" and the elapsed count advances within 15s.
3. **Two-device sync:** Log a bottle on device A, background device B for 2 minutes, foreground B. The entry appears within 2 seconds without restart.
