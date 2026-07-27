# Away Time Block (#149) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a caregiver mark a start/end time block as "away" (babysitter, other parent — nothing gets logged), exclude that time from wake-window/overtired-lag trend calculations, and pause reminders while away — plus fix a reminder-reliability bug this surfaced: client-side `setTimeout` notifications for bottle/meds/hygiene duplicate an already-working server push channel and get silently throttled/killed when the app is backgrounded.

**Architecture:** A new log entry `type: 'away'` reusing the exact sleep-style start/(optional)end pattern already in the codebase — no new sync plumbing needed since the server stores every entry type generically. Home hero and derived insight math get an away-aware override layered on top of existing branches (`night`/`newborn` for sweetSpot, `sleep`/`awake` for status). Reminders pause server-side while an away block is ongoing. Client-side bottle/meds/hygiene notification scheduling is deleted (server push already covers them reliably); the "remind me before" lead-time setting they used to honor moves server-side, reusing `push.go`'s existing due/fire-time split.

**Tech Stack:** Vanilla JS PWA (`js/*.js`, no framework), Go server (`server/*.go`, SQLite), `node:test` for JS unit tests, Playwright for E2E, Go's `testing` package.

## Global Constraints

- Bump the version (`scripts/bump-version.sh`) before committing any change to `js/`, `index.html`, `styles.css`, `sw.js`, or `icons/` — run once, right before the final commit of this plan, not per-task.
- Follow Conventional Commits for every git message.
- Add a changelog entry to `js/changelog.js` for the new feature (this is user-facing) under today's dated block.
- Lucide icons only, vendored inline in `index.html`'s `<body>` sprite.
- Reuse the existing neutral `tone-note` color rather than adding a new CSS color token.
- Run `node --test js/*.test.js` and `go test ./server` locally before the final commit; rely on CI for the Playwright E2E matrix per project convention (only run `CHROMIUM=/usr/bin/chromium npm test` locally if CI fails and you need to debug).

---

### Task 1: Vendor the `door-open` icon and register the `away` type

**Files:**
- Modify: `index.html` (sprite, after the `house` symbol, ~line 64)
- Modify: `js/ui.js:59-60` (`TYPES` map)

**Interfaces:**
- Produces: `TYPES.away = { icon: 'door-open', label: 'Away', tone: 'note' }`, and a `<symbol id="door-open">` usable via `icon('door-open')` — both consumed by Task 2 (`sheets.js` type picker, `home.js` `summary()`).

- [ ] **Step 1: Add the `door-open` Lucide symbol to the sprite**

In `index.html`, immediately after the closing `</symbol>` of the `house` symbol (search for `id="house"`), insert:

```html
<symbol id="door-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 20H2" />
  <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z" />
  <path d="M11 4H8a2 2 0 0 0-2 2v14" />
  <path d="M14 12h.01" />
  <path d="M22 20h-3" />
</symbol>
```

- [ ] **Step 2: Register the `away` type in `TYPES`**

In `js/ui.js`, add a new entry to the `TYPES` object (after the `hygiene` line):

```js
  hygiene:  { icon: 'icon-hygiene',  label: 'Hygiene',  tone: 'hygiene' },
  away:     { icon: 'door-open',     label: 'Away',     tone: 'note'   },
};
```

- [ ] **Step 3: Verify no JS syntax errors**

Run: `npm run check`
Expected: PASS (lint + `node --check` on all JS)

- [ ] **Step 4: Commit**

```bash
git add index.html js/ui.js
git commit -m "feat(ui): add away entry type icon and metadata"
```

---

### Task 2: Away entry form, save/edit, row rendering, and timeline filter

**Files:**
- Modify: `js/sheets.js` (`FORMS` object ~line 475-542, `gather()` ~line 544-594, `prefill()` ~line 660-687, `openTypeChooser()`'s `types` array ~line 710)
- Modify: `js/home.js` (`summary()` ~line 18-50)
- Modify: `js/timeline.js:39` (`OPTIONAL_FILTERS`)
- Test: `tests/away.test.js` (new)

**Interfaces:**
- Consumes: `TYPES.away` from Task 1.
- Produces: entries shaped `{ type: 'away', start, end: string|null, note: string|null }`, saved/loaded exactly like `sleep`. `home.js`'s `summary(e)` returns `{ label, detail, meta, tone, icon }` for an away entry, consumed by both `home.js` row rendering and `timeline.js` (which calls the same `summary()`).

- [ ] **Step 1: Write the failing E2E test**

Create `tests/away.test.js`:

```js
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18813);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // "away" isn't a pinned Home quick-action (like pump/note, it's occasional),
    // so it's reached through the "More" chooser rather than a direct button.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('.chooser');
    const chooserOffersAway = await page.$('.chooser [data-action="log:open"][data-type="away"]');
    check('the "More" type chooser offers Away', chooserOffersAway !== null);

    // Log a live away block (leave "back" blank).
    await page.click('.chooser [data-action="log:open"][data-type="away"]');
    await page.waitForSelector('[data-action="log:save"][data-type="away"]');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);

    const savedLive = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'away');
      return e ? { end: e.end, hasStart: !!e.start } : null;
    });
    check('a live away entry saves with no end', savedLive && savedLive.end == null && savedLive.hasStart, JSON.stringify(savedLive));

    // Row rendering shows "Away" / "since HH:MM" while ongoing.
    const rowText = await page.evaluate(() => document.querySelector('[data-id]')?.textContent || '');
    check('the ongoing away row reads "Away"', rowText.includes('Away'), rowText);

    // Edit the entry to set an end time, closing the block.
    const awayId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'away').id;
    });
    await page.click(`[data-id="${awayId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-end-date');
    await page.fill('#f-end-date', '2026-01-02');
    await page.fill('#f-end-time', '09:00');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);

    const closed = await page.evaluate((id) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.id === id).end;
    }, awayId);
    check('editing an away entry to add an end time saves it', !!closed, closed);

    // Re-opening for edit reselects the saved end date/time.
    await page.click(`[data-id="${awayId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-end-date');
    const reselectedDate = await page.$eval('#f-end-date', (el) => el.value);
    check('editing a closed away entry reselects its saved end date', reselectedDate === '2026-01-02', reselectedDate);
    await page.click('[data-action="sheet:close"]');
  } catch (e) {
    check('away entry test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/away.test.js`
Expected: FAIL — `[data-action="log:open"][data-type="away"]` never appears (type not yet in the picker), or the sheet never renders `#f-end-date`/`log:save` for type `away`.

- [ ] **Step 3: Add the `away` form to `FORMS`**

In `js/sheets.js`, add to the `FORMS` object, after the `hygiene` entry (before the closing `};` of `FORMS`):

```js
  away: () => `
    ${field('Away since', dtPair('f-time', nowLocalDT()))}
    ${field('Back (leave blank if still away)', dtPair('f-end', nowLocalDT().slice(0, 10)))}
    ${noteRow()}`,
};
```

(Remove the old closing `};` after `hygiene`'s entry and use this one instead.)

- [ ] **Step 4: Handle `away` in `gather()`**

In `js/sheets.js`'s `gather(type)`, add a new branch after the `hygiene` branch (before the final `return base;`):

```js
  } else if (type === 'hygiene') {
    const id = $('#f-hyg').value;
    const it = state().settings.hygiene.find((x) => x.id === id);
    if (!it) return base;
    base.itemId = id; base.name = it.name;
  } else if (type === 'away') {
    const endLocal = readDT('f-end');
    base.end = endLocal ? dtToISO(endLocal) : null;
  }
  return base;
```

- [ ] **Step 5: Handle `away` in `prefill()`**

In `js/sheets.js`'s `prefill(type, e)`, add a branch after the `hygiene` branch:

```js
  else if (type === 'hygiene') { if ($('#f-hyg')) $('#f-hyg').value = e.itemId; }
  else if (type === 'away') { if (e.end) writeDT('f-end', e.end); }
}
```

- [ ] **Step 6: Add `away` to the type picker**

In `js/sheets.js`'s `openTypeChooser()`, update the `types` array:

```js
  const types = ['sleep', 'feed', 'bottle', 'diaper', 'medicine', 'pump', 'note', 'play', 'bath', 'hygiene', 'away'];
```

- [ ] **Step 7: Add `away` row rendering in `summary()`**

In `js/home.js`'s `summary(e)`, add a branch after the `hygiene` branch (before the closing `return { label, ... }`):

```js
  } else if (e.type === 'hygiene') {
    label = e.name || 'Hygiene'; detail = fmt.clock(e.start); meta = e.note || '';
  } else if (e.type === 'away') {
    label = e.end ? 'Was away' : 'Away';
    if (e.end) { detail = fmt.clock(e.start) + ' – ' + fmt.clock(e.end); meta = fmt.dur((new Date(e.end) - new Date(e.start)) / 60000); }
    else { detail = 'since ' + fmt.clock(e.start); meta = 'now'; }
  }
```

- [ ] **Step 8: Add `away` to the timeline filter chips**

In `js/timeline.js`, update `OPTIONAL_FILTERS`:

```js
const OPTIONAL_FILTERS = ['feed', 'diaper', 'pump', 'note', 'play', 'bath', 'away'];
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `node tests/away.test.js`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add js/sheets.js js/home.js js/timeline.js tests/away.test.js
git commit -m "feat(log): add away entry type with start/end and a note"
```

---

### Task 3: Home hero away state

**Files:**
- Modify: `js/store.js` (`derive.status()` ~line 495-502, `derive.sweetSpot()` ~line 503-525, `derive.sweetSpotSchedule()` ~line 526-549)
- Modify: `js/home.js` (`heroCard()` ~line 158-192)
- Test: `tests/away.test.js` (extend), `js/store.test.js` (append)

**Interfaces:**
- Consumes: `type: 'away'` entries from Task 2's `addEntry`/`updateEntry` flow.
- Produces: `derive.status()` returns `{ state: 'away', since: Date }` when an away block is ongoing (a new possible `state` value alongside the existing `'asleep'`/`'awake'`). `derive.sweetSpot()` returns `{ away: true, napping: false, from: null, to: null, prediction: null }` in that case, and `derive.sweetSpotSchedule()` returns `[]` — consumed by Task 4's exclusion logic is unaffected (separate functions), but any future hero/sweetspot code must handle this three-way state.

- [ ] **Step 1: Extend the E2E test to assert the hero shows an away state**

Append to `tests/away.test.js`, just before the `finally` block (replace the final `await page.click('[data-action="sheet:close"]');` line with the block below, keeping that line and adding after it):

```js
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Start a fresh, still-ongoing away block and check the hero reflects it.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('.chooser');
    await page.click('.chooser [data-action="log:open"][data-type="away"]');
    await page.waitForSelector('[data-action="log:save"][data-type="away"]');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);
    const heroText = await page.evaluate(() => document.querySelector('.hero .state-lbl')?.textContent || '');
    check('the hero shows "Away since" while an away block is ongoing', heroText.includes('Away since'), heroText);
    const heroSubText = await page.evaluate(() => document.querySelector('.hero .hero-sub')?.textContent || '');
    check('the hero away state has no sweetspot rail', await page.$('.hero .sh-rail-wrap') === null, heroSubText);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/away.test.js`
Expected: FAIL — hero still shows "Awake since"/"Asleep since", not "Away since".

- [ ] **Step 3: Add the away accessor and override `derive.status()`**

In `js/store.js`, add a new accessor near `sleeps()` (~line 470):

```js
const sleeps = () => _state.log.filter((e) => e.type === 'sleep');
const aways = () => _state.log.filter((e) => e.type === 'away');
```

Then update `derive.status()`:

```js
  status() {
    const now = new Date();
    const ongoingAway = aways().find((e) => !e.end && new Date(e.start) <= now);
    if (ongoingAway) return { state: 'away', since: new Date(ongoingAway.start) };
    const ss = sleeps();
    const ongoing = ss.find((e) => !e.end && new Date(e.start) <= now);
    if (ongoing) return { state: 'asleep', since: new Date(ongoing.start) };
    let lastWake = null;
    ss.forEach((e) => { if (e.end) { const d = new Date(e.end); if (!lastWake || d > lastWake) lastWake = d; } });
    return { state: 'awake', since: lastWake || new Date(Date.now() - 80 * MIN) };
  },
```

- [ ] **Step 4: Add the `away` gate to `derive.sweetSpot()` and `derive.sweetSpotSchedule()`**

In `js/store.js`, update `sweetSpot()` to check status first:

```js
  sweetSpot() {
    const st = derive.status();
    if (st.state === 'away') return { away: true, napping: false, from: null, to: null, prediction: null };
    const pos = wakePosition();
```

(The rest of the function body is unchanged.)

- [ ] **Step 5: Write a failing unit test for `sweetSpotSchedule()`'s away gate**

`sweetSpotSchedule()` (the Sleep view's upcoming-nap-windows list) reads
`derive.status()` independently of `sweetSpot()` — without its own gate it
would keep projecting nap windows anchored to the away block's start.
Append to `js/store.test.js`, after the last `derive.sweetSpot` test
(search for the last `test('derive.sweetSpot` occurrence and add after
that test's closing `});`):

```js
test('derive.sweetSpotSchedule returns empty during an ongoing away block', () => {
  reset();
  const now = new Date();
  addEntry({ type: 'away', start: new Date(now.getTime() - 30 * 60000).toISOString() });
  const result = derive.sweetSpotSchedule();
  assert.deepEqual(result, []);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `sweetSpotSchedule()` still projects windows since it doesn't check `status()`.

- [ ] **Step 7: Add the `away` gate to `derive.sweetSpotSchedule()`**

In `js/store.js`, update `sweetSpotSchedule()`:

```js
  sweetSpotSchedule(limit = 4) {
    const out = [];
    if (derive.status().state === 'away') return out;
    const today = startOfDay(Date.now());
```

(The rest of the function body is unchanged.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 9: Add the `away` branch to `heroCard()`**

In `js/home.js`'s `heroCard()`, insert a new branch right after the `timer` constant is defined and before the `if (sp.night) {` check:

```js
  const timer = `<div class="timer">${t.h ? t.h + '<span class="u">h</span> ' : ''}${t.m}<span class="u">m</span></div>`;

  if (sp.away) {
    return open('data-state="away"') + `
      <div class="state"><span class="livedot"></span><span class="state-lbl">Away since ${fmt.clock(st.since)}</span></div>
      ${timer}
      <div class="hero-sub">No logging expected while away.</div>` + close;
  }

  // The ember-glow ground+field replaces the 16-coal bed: same warm ember
```

- [ ] **Step 10: Run the E2E test to verify it passes**

Run: `node tests/away.test.js`
Expected: PASS

- [ ] **Step 11: Run the full unit suite to check for regressions**

Run: `node --test js/*.test.js`
Expected: PASS (no existing test asserted the old two-state `status()`/`sweetSpot()` shape in a way that breaks — the new `away` branch only activates when an away entry exists, and no other test creates one).

- [ ] **Step 12: Commit**

```bash
git add js/store.js js/home.js tests/away.test.js
git commit -m "feat(home): show an away state on the hero during an away block"
```

---

### Task 4: Exclude away-overlapping wake gaps from trend/insight math

**Files:**
- Modify: `js/store.js` (`personalWakeWindow()` ~line 634-661, `insightOvertiredLag()` ~line 728-757)
- Test: `js/store.test.js` (append new tests)

**Interfaces:**
- Consumes: `aways()` from Task 3.
- Produces: `overlapsAway(startMs, endMs)` — a new module-private helper, returns `true` if any away block's interval intersects `[startMs, endMs)`.

- [ ] **Step 1: Write the failing unit tests**

Append to `js/store.test.js`, at the very end of the file, after the last test in it (there are two more `derive.insightOvertiredLag` tests after `'returns null with too few valid triples'` — add these two new tests after the final one in the file, not after that specific one):

```js
test('derive.personalWakeWindow excludes a wake gap that overlaps an away block', () => {
  reset();
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Same 10-day 90-min-wake-window fixture as the earlier personalWakeWindow
  // test, but day 5's wake gap gets an away block logged over it.
  for (let d = 10; d >= 1; d--) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const sleepAEnd = new Date(base.getTime() + 12 * 60 * MIN_MS);
    const sleepAStart = new Date(sleepAEnd.getTime() - 70 * MIN_MS);
    const sleepBStart = new Date(sleepAEnd.getTime() + 90 * MIN_MS);
    const sleepBEnd = new Date(sleepBStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: sleepAStart.toISOString(), end: sleepAEnd.toISOString() });
    addEntry({ type: 'sleep', start: sleepBStart.toISOString(), end: sleepBEnd.toISOString() });
    if (d === 5) {
      addEntry({ type: 'away', start: new Date(sleepAEnd.getTime() + 10 * MIN_MS).toISOString(), end: new Date(sleepAEnd.getTime() + 40 * MIN_MS).toISOString() });
    }
  }
  const result = derive.personalWakeWindow('middle');
  assert.ok(result !== null, 'should still return data with 9 clean observations');
  assert.equal(result.sampleSize, 9, `sampleSize ${result.sampleSize} should drop by exactly 1 (the away-overlapping day)`);
});

test('derive.insightOvertiredLag excludes a wake gap that overlaps an away block', () => {
  reset();
  const now = Date.now();
  const DAY_MS = 86400000;
  const MIN_MS = 60000;
  // Same 12-day overtired-lag fixture as the "narrates" test, but day 1's
  // wake gap (an overshoot day) gets an away block logged over it.
  for (let d = 1; d <= 12; d++) {
    const base = new Date(now - d * DAY_MS);
    base.setHours(0, 0, 0, 0);
    const napPrevStart = new Date(base.getTime() + 9 * 60 * MIN_MS);
    const napPrevEnd = new Date(napPrevStart.getTime() + 20 * MIN_MS);
    const overshoot = d <= 6;
    const gapMin = overshoot ? 150 : 70;
    const napIStart = new Date(napPrevEnd.getTime() + gapMin * MIN_MS);
    const napIEnd = new Date(napIStart.getTime() + 70 * MIN_MS);
    const napNextStart = new Date(napIEnd.getTime() + 90 * MIN_MS);
    const napNextEnd = new Date(napNextStart.getTime() + 70 * MIN_MS);
    addEntry({ type: 'sleep', start: napPrevStart.toISOString(), end: napPrevEnd.toISOString() });
    addEntry({ type: 'sleep', start: napIStart.toISOString(), end: napIEnd.toISOString() });
    addEntry({ type: 'sleep', start: napNextStart.toISOString(), end: napNextEnd.toISOString(), quality: overshoot ? 'Restless' : 'Great' });
    if (d === 1) {
      addEntry({ type: 'away', start: new Date(napPrevEnd.getTime() + 5 * MIN_MS).toISOString(), end: new Date(napPrevEnd.getTime() + 60 * MIN_MS).toISOString() });
    }
  }
  const result = derive.insightOvertiredLag();
  assert.ok(result !== null, 'the remaining 11 clean triples should still clear every threshold');
  assert.equal(result.sampleSize, 11, `sampleSize ${result.sampleSize} should drop by exactly 1 (the away-overlapping day)`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test js/store.test.js`
Expected: FAIL on both new tests — `sampleSize` is still 10/12 because `overlapsAway` doesn't exist yet and away entries aren't excluded.

- [ ] **Step 3: Add the `overlapsAway` helper**

In `js/store.js`, add a helper function right after the `aways()` accessor added in Task 3:

```js
const aways = () => _state.log.filter((e) => e.type === 'away');

// True if any away block's interval intersects [startMs, endMs). Used to drop
// wake-gap observations that overlap an away block from the wake-window and
// overtired-lag insight math, since a real nap or feed may have happened
// there unlogged -- the gap isn't a clean "how long can baby stay awake"
// signal regardless of how much of it overlaps.
function overlapsAway(startMs, endMs) {
  return aways().some((e) => {
    const aStart = new Date(e.start).getTime();
    const aEnd = e.end ? new Date(e.end).getTime() : Date.now();
    return aStart < endMs && aEnd > startMs;
  });
}
```

- [ ] **Step 4: Apply the exclusion in `personalWakeWindow()`**

In `js/store.js`'s `personalWakeWindow(position)`, add the guard inside the loop, right after the existing sanity-bounds check:

```js
      const wakeMin = (wakeEnd - wakeStart) / MIN;
      if (wakeMin < 10 || wakeMin > 360) continue; // sanity bounds
      if (overlapsAway(wakeStart.getTime(), wakeEnd.getTime())) continue;
      if (wakePosition(wakeStart) !== position) continue;
```

- [ ] **Step 5: Apply the exclusion in `insightOvertiredLag()`**

In `js/store.js`'s `insightOvertiredLag()`, add the guard right after the existing sanity-bounds check:

```js
      const wakeGapMin = (new Date(napI.start) - new Date(napPrev.end)) / MIN;
      if (wakeGapMin < MIN_PLAUSIBLE_MIN || wakeGapMin > MAX_PLAUSIBLE_MIN) continue;
      if (overlapsAway(new Date(napPrev.end).getTime(), new Date(napI.start).getTime())) continue;
      const pos = wakePosition(new Date(napPrev.end));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test js/store.test.js`
Expected: PASS, including the two new tests and every pre-existing test in the file.

- [ ] **Step 7: Commit**

```bash
git add js/store.js js/store.test.js
git commit -m "feat(insights): exclude away-overlapping wake gaps from trend math"
```

---

### Task 5: Pause push reminders during an ongoing away block

**Files:**
- Modify: `server/push.go` (`familyReminders()` ~line 365-482)
- Test: `server/push_test.go` (append new tests)

**Interfaces:**
- Consumes: `type: 'away'` log entries (already stored generically via the existing `log_entries` table, no schema change).
- Produces: `familyReminders(familyID)` returns an empty `[]pushReminder` (no error) whenever an ongoing away block exists for that family — consumed by `ScheduleFamily`/`ScheduleAll`, unchanged.

- [ ] **Step 1: Write the failing Go tests**

Append to `server/push_test.go`, after `TestFamilyRemindersIgnoresEmptyStringIntervalKeyWithoutPanicking` (at the end of the file):

```go
func TestFamilyRemindersSkippedDuringOngoingAway(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	// a bottle logged 3h ago is due now under the 3h interval
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)
	// an away block started an hour ago, still ongoing (no end in the payload)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1', 'fam1', 'away', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-1*time.Hour).UTC().Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	if len(reminders) != 0 {
		t.Fatalf("expected no reminders during an ongoing away block, got %+v", reminders)
	}
}

func TestFamilyRemindersResumeAfterAwayEnds(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)
	// a past away block that already ended
	awayEnd := time.Now().Add(-4 * time.Hour).UTC().Format(time.RFC3339Nano)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1', 'fam1', 'away', ?, ?, 'cg1', ?)`,
		time.Now().Add(-5*time.Hour).UTC().Format(time.RFC3339Nano),
		`{"end":"`+awayEnd+`"}`,
		now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var foundBottle bool
	for _, r := range reminders {
		if r.Key == "bottle" {
			foundBottle = true
		}
	}
	if !foundBottle {
		t.Fatalf("expected a bottle reminder once the away block has ended, got %+v", reminders)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./server -run TestFamilyRemindersSkippedDuringOngoingAway`
Run: `go test ./server -run TestFamilyRemindersResumeAfterAwayEnds`
Expected: both FAIL. `TestFamilyRemindersSkippedDuringOngoingAway` fails because the reminders list is non-empty (no away-check exists yet). `TestFamilyRemindersResumeAfterAwayEnds` also fails as written today — `quietStart == quietEnd` means no quiet hours are in effect (see `isQuietAt`, `server/push.go:95-109`: it special-cases `s == e` to always return `false`), so the bottle reminder should already be present without any away-check; if it's failing for a different reason (e.g. `bottleInterval`/fixture typo), fix that before proceeding to Step 3 — this test must be a green regression guard on its own, not just "not failing because of quiet hours."

- [ ] **Step 3: Add the ongoing-away check to `familyReminders()`**

In `server/push.go`'s `familyReminders(familyID string)`, insert this check right after `reminders := []pushReminder{}` (do not remove the following `if settings.Bottle {` line — the new block is inserted between the two, nothing is replaced):

```go
	settings := parseReminderSettings(remindersJSON)
	reminders := []pushReminder{}
	var ongoingAwayID string
	err := s.db.QueryRow(`SELECT id FROM log_entries WHERE family_id = ? AND type = 'away' AND deleted_at IS NULL AND json_extract(payload_json, '$.end') IS NULL AND start <= ? ORDER BY start DESC LIMIT 1`,
		familyID, time.Now().UTC().Format(time.RFC3339Nano)).Scan(&ongoingAwayID)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("push: familyReminders family=%s away: read ongoing away failed: %v", familyID, err)
	}
	if err == nil {
		return reminders, nil // ongoing away block: nothing expected to be logged
	}
	if settings.Bottle {
```

The last line above (`if settings.Bottle {`) is the same line already in the file — it's shown only for placement context. Everything from `var ongoingAwayID string` through the `if err == nil { return reminders, nil ... }` block is new; nothing existing is deleted or replaced.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./server -run TestFamilyReminders`
Expected: PASS for every `TestFamilyReminders*` test, including both new ones.

- [ ] **Step 5: Run the full Go suite to check for regressions**

Run: `go test ./server`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add server/push.go server/push_test.go
git commit -m "fix(push): pause reminders while an away block is ongoing"
```

---

### Task 6: Remove duplicate client-side bottle/meds/hygiene reminder scheduling

**Files:**
- Modify: `js/store.js` (`derive.reminders()` ~line 900-939)
- Modify: `js/reminders.js` (`scheduleReminders()` ~line 160-193)
- Test: `js/store.test.js` (append)

**Interfaces:**
- Produces: `derive.reminders()` now only ever returns the `'nap'`-keyed
  reminder (or an empty array) — never `'bottle'`, `'med-*'`, or `'hyg-*'`
  keys. `scheduleReminders()` is unaffected in shape (it still iterates
  whatever `derive.reminders()` returns and schedules a local
  `Notification` per entry); it just receives fewer entries now.

`server/push.go`'s scheduler already delivers bottle/meds/hygiene
reminders via real Web Push (`sw.js`'s `push` event handler shows them even
when the app is closed), so the client-side `setTimeout` copies in
`derive.reminders()` are pure duplication — and unlike server push, they
get throttled or killed by the browser whenever the app is backgrounded,
which is what made "sometimes no notification arrives" possible before
this task. Nap reminders are unaffected: there is no server-side
equivalent of the SweetSpot age/wake-window prediction, so they stay
client-side.

- [ ] **Step 1: Write a failing unit test**

Append to `js/store.test.js`, at the end of the file (after the tests added
in Task 4):

```js
test('derive.reminders() no longer schedules bottle/meds/hygiene locally (server push covers them)', () => {
  reset();
  const keys = derive.reminders().map((r) => r.key);
  assert.ok(!keys.includes('bottle'), 'bottle should not be locally scheduled: server push already delivers it');
  assert.ok(!keys.some((k) => k.startsWith('med-')), 'medicine reminders should not be locally scheduled: server push already delivers them');
  assert.ok(!keys.some((k) => k.startsWith('hyg-')), 'hygiene reminders should not be locally scheduled: server push already delivers them');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test js/store.test.js`
Expected: FAIL — `keys` includes `'bottle'` (default settings have `reminders.bottle: true`, and `derive.nextBottle()` always returns a computed due time even with no feed entries logged, so the branch always produces an entry today).

- [ ] **Step 3: Remove the bottle/meds/hygiene branches from `derive.reminders()`**

In `js/store.js`, replace the whole `reminders()` function body:

```js
  reminders() {
    const r = _state.settings.reminders, out = [];
    if (r.naps) { const sp = derive.sweetSpot(); if (!sp.napping && !sp.night && sp.from) { const at = sp.from.getTime(); out.push({ key: 'nap', title: 'Nap time soon', body: 'SweetSpot nap window is approaching.', at, dueAt: at, dueTitle: 'Nap time soon', dueBody: 'SweetSpot nap window is approaching.' }); } }
    return out.sort((a, b) => a.at - b.at);
  }
```

(This deletes the `leadMs` computation and the `if (r.bottle)`, `if (r.meds)`, `if (r.hygiene)` blocks entirely — `leadMs` was only ever consumed by those three blocks, never by the nap branch.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 5: Simplify `scheduleReminders()`'s now-dead quiet-hours exemption**

In `js/reminders.js`, the `!rem.key.startsWith('med-')` check exists only
because medicine reminders used to be exempt from client-side quiet-hours
suppression — with medicine reminders removed, no key can ever start with
`'med-'` again, so the check is dead. Simplify:

```js
    if (isQuiet(rem.at, quietStart, quietEnd)) return;
```

(replaces `if (!rem.key.startsWith('med-') && isQuiet(rem.at, quietStart, quietEnd)) return;` — behavior for the remaining `'nap'` key is unchanged, since `'nap'` never matched the `'med-'` prefix anyway.)

- [ ] **Step 6: Run the full unit suite to check for regressions**

Run: `node --test js/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add js/store.js js/reminders.js js/store.test.js
git commit -m "fix(reminders): remove duplicate client-side bottle/meds/hygiene scheduling"
```

---

### Task 7: Port reminder lead-time to server-side push scheduling

**Files:**
- Modify: `server/push.go` (`reminderSettings` struct ~line 54-60, `pushReminder` struct ~line 182-188, `backoffFireAt()` ~line 194-205, `resolveScheduled()` ~line 212-249, `familyReminders()` ~line 365-482, `scheduleLocked()` ~line 311-329)
- Modify: `server/push_test.go` (`TestBackoffFireAtSchedule` ~line 469-488, append new tests)

**Interfaces:**
- Consumes: nothing new from earlier tasks in this plan.
- Produces: `reminderSettings.Lead float64` (minutes, `json:"lead"`, zero-value default). `pushReminder` gains `LeadTitle string`/`LeadBody string` fields. `backoffFireAt(due time.Time, stage int, lead time.Duration) (time.Time, bool)` — signature changed, now takes `lead` as a third parameter.

Task 6 removed the client's only way of honoring `settings.reminders.lead`
("Remind me before", `js/profile.js:127`) for bottle/meds/hygiene — without
this task, that setting would silently do nothing for 3 of its 4 reminder
types. `pushReminder` already has the exact mechanism this needs:
`DueAt` (the true due moment, the backoff dedupe key) versus `At` (the
actual fire time, which backoff can already push *later*). Lead is the
same idea in the other direction — pushing `At` *earlier* than `DueAt`.

- [ ] **Step 1: Write a failing test for `backoffFireAt`'s new `lead` parameter**

In `server/push_test.go`, update `TestBackoffFireAtSchedule` (the existing
test) to pass a `lead` argument and add a lead-specific case:

```go
func TestBackoffFireAtSchedule(t *testing.T) {
	due := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		stage int
		lead  time.Duration
		want  time.Time
		ok    bool
	}{
		{0, 0, due, true},
		{0, 30 * time.Minute, due.Add(-30 * time.Minute), true},
		{1, 30 * time.Minute, due.Add(15 * time.Minute), true}, // backoff retries ignore lead
		{1, 0, due.Add(15 * time.Minute), true},
		{2, 0, due.Add(75 * time.Minute), true},
		{3, 0, time.Time{}, false},
		{4, 0, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := backoffFireAt(due, c.stage, c.lead)
		if ok != c.ok || (ok && !got.Equal(c.want)) {
			t.Errorf("backoffFireAt(due, %d, %v) = (%v, %v), want (%v, %v)", c.stage, c.lead, got, ok, c.want, c.ok)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./server -run TestBackoffFireAtSchedule`
Expected: FAIL to compile — `backoffFireAt` only takes 2 arguments today.

- [ ] **Step 3: Add the `lead` parameter to `backoffFireAt`**

In `server/push.go`, update `backoffFireAt`:

```go
func backoffFireAt(due time.Time, stage int, lead time.Duration) (time.Time, bool) {
	switch stage {
	case 0:
		return due.Add(-lead), true
	case 1:
		return due.Add(15 * time.Minute), true
	case 2:
		return due.Add(75 * time.Minute), true
	default:
		return time.Time{}, false
	}
}
```

- [ ] **Step 4: Update `resolveScheduled()`'s call site**

In `server/push.go`'s `resolveScheduled()`, compute `lead` from settings and pass it through:

```go
	settings := parseReminderSettings(remindersJSON)
	lead := time.Duration(settings.Lead * float64(time.Minute))
	out := make([]pushReminder, 0, len(raw))
	for _, r := range raw {
```

and:

```go
		fireAt, ok := backoffFireAt(r.At, stage, lead)
```

Also carry `LeadTitle`/`LeadBody` through to the returned reminder (the
final due/lead phrasing choice happens later, at actual fire time, in Step
7 — not here):

```go
		out = append(out, pushReminder{Key: r.Key, Title: r.Title, Body: r.Body, LeadTitle: r.LeadTitle, LeadBody: r.LeadBody, At: fireAt, DueAt: r.At})
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./server -run TestBackoffFireAtSchedule`
Expected: PASS

Run: `go test ./server`
Expected: PASS — this alone doesn't yet change any other test's behavior, since `settings.Lead` defaults to `0` and `lead=0` makes `backoffFireAt`'s stage-0 case identical to before (`due.Add(0) == due`).

- [ ] **Step 6: Add the `Lead` field and `LeadTitle`/`LeadBody`, and build lead-phrased copy in `familyReminders()`**

In `server/push.go`, add the field to `reminderSettings`:

```go
type reminderSettings struct {
	Bottle     bool    `json:"bottle"`
	Meds       bool    `json:"meds"`
	Hygiene    bool    `json:"hygiene"`
	Lead       float64 `json:"lead"`
	QuietStart string  `json:"quietStart"`
	QuietEnd   string  `json:"quietEnd"`
}
```

and to `pushReminder`:

```go
type pushReminder struct {
	Key       string
	Title     string
	Body      string
	LeadTitle string    // shown instead of Title when firing early, via Lead
	LeadBody  string
	At        time.Time // actual fire time — may be delayed past DueAt by backoff, or moved earlier by lead
	DueAt     time.Time // the reminder's true due time; the dedupe key for backoff state
}
```

Then in `familyReminders()`, set `LeadTitle`/`LeadBody` alongside each
bottle/meds/hygiene reminder it already builds (only when a lead is
actually configured — leave both empty otherwise, which Step 7 treats as
"no lead phrasing available"). For bottle:

```go
			if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
				at := t.Add(time.Duration(bottleInterval * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					rem := pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at}
					if settings.Lead > 0 {
						rem.LeadTitle = "Feed coming up"
						rem.LeadBody = fmt.Sprintf("Next feed in about %d min.", int(settings.Lead))
					}
					reminders = append(reminders, rem)
				}
			} else {
```

(This replaces the existing `reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at})` line and the `if` wrapping it — the surrounding `if err == nil { ... } else { log.Printf(...) }` structure is otherwise unchanged.)

For meds (inside the `for _, med := range meds` loop):

```go
			if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
				at := t.Add(time.Duration(med.EveryH * float64(time.Hour)))
				rem := pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: at}
				if settings.Lead > 0 {
					rem.LeadTitle = med.Name + " coming up"
					rem.LeadBody = fmt.Sprintf("%s%s in about %d min.", med.Dose, med.Unit, int(settings.Lead))
				}
				reminders = append(reminders, rem)
			} else {
```

(Replaces the existing single-line `reminders = append(reminders, pushReminder{Key: "med-" + med.ID, ...})` call — meds have no `isQuietAt` gate today and this doesn't add one.)

For hygiene (inside the `for _, it := range items` loop):

```go
			if t, err := time.Parse(time.RFC3339Nano, last); err == nil {
				at := t.Add(time.Duration(it.EveryH * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					rem := pushReminder{Key: "hyg-" + it.ID, Title: it.Name + " due", Body: it.Name + " is due now.", At: at}
					if settings.Lead > 0 {
						rem.LeadTitle = it.Name + " coming up"
						rem.LeadBody = fmt.Sprintf("%s in about %d min.", it.Name, int(settings.Lead))
					}
					reminders = append(reminders, rem)
				}
			} else {
```

- [ ] **Step 7: Choose due-vs-lead phrasing at actual fire time in `scheduleLocked()`**

In `server/push.go`'s `scheduleLocked()`, decide the final `Title`/`Body`
right before sending — not earlier — because a lead-scheduled fire can
still land at or after `DueAt` in practice (a delayed tick, a resumed
process), the same race `js/reminders.js`'s client-side `overdue` check
used to guard against:

```go
func (s *pushScheduler) scheduleLocked(familyID, key string, rem pushReminder, delay time.Duration) {
	reminder := rem
	s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
		s.advanceStage(familyID, reminder)
		final := reminder
		if final.LeadTitle != "" && time.Now().Before(final.DueAt) {
			final.Title, final.Body = final.LeadTitle, final.LeadBody
		}
		s.sendFamily(familyID, final)
		s.mu.Lock()
		delete(s.pending, key)
		delete(s.byFamily[familyID], key)
		if len(s.byFamily[familyID]) == 0 {
			delete(s.byFamily, familyID)
		}
		s.mu.Unlock()
	})}
}
```

- [ ] **Step 8: Write a failing integration test for lead-time end-to-end**

Append to `server/push_test.go`, after the two away tests added in Task 5:

```go
func TestFamilyRemindersAppliesLeadTime(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, '{}', ?)`,
		"fam1",
		`{"bottle":true,"meds":false,"hygiene":false,"lead":30,"quietStart":"00:00","quietEnd":"00:00"}`,
		now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	raw, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var bottle pushReminder
	for _, r := range raw {
		if r.Key == "bottle" {
			bottle = r
		}
	}
	if bottle.LeadTitle == "" {
		t.Fatalf("expected a lead-phrased title on the raw bottle reminder, got %+v", bottle)
	}

	resolved := s.resolveScheduled("fam1", raw)
	var fireAt time.Time
	var found bool
	for _, r := range resolved {
		if r.Key == "bottle" {
			fireAt, found = r.At, true
		}
	}
	if !found {
		t.Fatalf("expected a scheduled bottle reminder, got %+v", resolved)
	}
	wantFireAt := bottle.At.Add(-30 * time.Minute)
	if !fireAt.Equal(wantFireAt) {
		t.Fatalf("expected fireAt %v (due minus 30min lead), got %v", wantFireAt, fireAt)
	}
}
```

- [ ] **Step 9: Run the test to verify it fails, then passes**

Run: `go test ./server -run TestFamilyRemindersAppliesLeadTime`
Expected (before Step 6/7's code lands, if run in isolation against a
pre-edit checkout): FAIL — `LeadTitle` is always empty since `familyReminders()`
doesn't set it yet. Since Steps 6-7 are already applied by this point in a
normal top-to-bottom run, expect PASS instead — this step exists to confirm
the test actually exercises the new behavior. If unsure, temporarily revert
Step 6 in a scratch copy and confirm the test fails there before restoring.

- [ ] **Step 10: Run the full Go suite to check for regressions**

Run: `go test ./server`
Expected: PASS, 0 failures — including `TestFamilyRemindersSkippedDuringOngoingAway` and `TestFamilyRemindersResumeAfterAwayEnds` from Task 5, both of which use `lead` implicitly defaulting to `0` in their JSON fixtures (the field is simply absent, which `json.Unmarshal` leaves at its zero value).

- [ ] **Step 11: Commit**

```bash
git add server/push.go server/push_test.go
git commit -m "feat(push): port reminder lead-time from client to server scheduling"
```

---

### Task 8: Version bump, changelog, final verification, PR

**Files:**
- Modify: `index.html` (`<meta name="version">`)
- Modify: `sw.js` (`VERSION` constant)
- Modify: `js/changelog.js` (today's dated block)

- [ ] **Step 1: Bump the version**

Run: `scripts/bump-version.sh`
Expected: prints the matching timestamp lines for `index.html` and `sw.js`.

- [ ] **Step 2: Add a changelog entry**

In `js/changelog.js`, add two one-line, plain-language entries under today's dated block (create a new block at the top if today's date isn't already the most recent one) — the feature first, then the fix:

```js
"Mark a stretch of time as “away” (like when a babysitter has the baby) — reminders pause and that time won't skew your trends."
"Fixed a bug where bottle, medicine, and hygiene reminders could silently fail to notify you when the app was closed or in the background."
```

Match the file's existing block/array structure exactly — read the top of `js/changelog.js` first to see today's most recent block before editing.

- [ ] **Step 3: Run the full local verification suite**

Run: `node --test js/*.test.js`
Expected: PASS, 0 failures (includes the new `store.test.js` tests from Tasks 3, 4, and 6).

Run: `go test ./server`
Expected: PASS, 0 failures (includes the new `push_test.go` tests from Tasks 5 and 7).

Run: `node tests/away.test.js`
Expected: PASS (the new E2E suite from Tasks 2-3).

Run: `npm run check`
Expected: PASS (lint + syntax check across all touched JS).

- [ ] **Step 4: Commit the version bump and changelog**

```bash
git add index.html sw.js js/changelog.js
git commit -m "chore: bump version and changelog for away time block"
```

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin worktree-issue-149-away-block
gh pr create --title "feat: add an away time block that excludes itself from trends and reminders" --body "$(cat <<'EOF'
## Summary
- New \`away\` log entry type (start/optional-end, same pattern as sleep) markable from the existing type picker, for stretches like a babysitter visit where nothing gets logged.
- The Home hero shows an "Away since" state while a block is ongoing, overriding asleep/awake.
- Wake-window and overtired-lag insight math, and the Sleep view's upcoming-nap schedule, drop/skip anything that overlaps an away block, instead of treating unlogged time as real awake time.
- Push reminders (bottle/meds/hygiene/etc.) pause entirely while an away block is ongoing and resume automatically once it's closed.
- Fixed: bottle/meds/hygiene reminders no longer duplicate scheduling client-side (where they could get silently throttled or killed when the app was backgrounded) — they're server push only now, and the "remind me before" lead-time setting moved server-side with them so it still works.

Closes #149. Supersedes #143.

## Test plan
- [x] \`node --test js/*.test.js\`
- [x] \`go test ./server\`
- [x] \`node tests/away.test.js\`
- [x] \`npm run check\`
- [ ] CI Playwright E2E matrix (full suite)
EOF
)"
```

- [ ] **Step 6: Wait for CI, then merge**

Poll with `gh-axi pr checks <N>` (or `gh pr checks <N>`) until all checks pass — the `e2e` leg can report a stale "pending" for a cycle or two after it actually finishes; cross-check with `gh run list --branch worktree-issue-149-away-block --limit 3` if it seems stuck. Once green:

```bash
gh pr merge <N> --merge
```

(Omit `--delete-branch` if running from inside this worktree — merging with the branch checked out in a worktree fails that flag. Clean up the worktree/branch afterward via `ExitWorktree` with `action: "remove", discard_changes: true`, then sync `main`: `git pull --ff-only origin main && git push origin main` from the main checkout.)
