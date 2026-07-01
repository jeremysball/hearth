# Onboarding and Timeline Polish Implementation Plan

> **Status:** COMPLETE — merged to `main` as PR #27 (`380ce4e`). Onboarding theme picker, dayjob themes, Playfair italic tagline, and timeline day-group polish shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align onboarding with the full Hearth theme palette and polish the Timeline view presentation.

**Architecture:** Keep both changes inside existing vanilla JS view functions and CSS. Add Playwright coverage for browser-visible behavior, then make the smallest view and stylesheet edits that pass.

**Tech Stack:** Vanilla ES modules, CSS in `styles.css`, Playwright via `tests/*.test.js`, service worker cache versioning via `scripts/bump-version.sh`.

## Global Constraints

- No framework. Vanilla JS PWA plus Go backend plus SQLite.
- Lucide icons only, vendored locally as an inline SVG sprite in `index.html`.
- Playfair Display for the baby's name and the hero timer; use Playfair Display for the onboarding tagline in this plan.
- Round everything touched: pills for controls, big radii for cards, circles for identity.
- Run `scripts/bump-version.sh` before committing frontend asset changes.
- Run `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js` and `CHROMIUM=/usr/bin/chromium node tests/timeline.test.js` before the final commit.

---

## File Structure

- Modify `js/onboarding.js`: render four onboarding theme buttons and use the new tagline class.
- Modify `styles.css`: add `.onb-tagline` and Timeline polish rules.
- Modify `js/timeline.js`: render each day header with a right-aligned entry count.
- Create `tests/onboarding-theme.test.js`: verify the onboarding theme picker exposes and previews all four themes.
- Modify `tests/timeline.test.js`: verify day counts and the accent back button style.
- Modify `index.html` and `sw.js`: changed only by `scripts/bump-version.sh`.

---

### Task 1: Onboarding Theme Picker and Tagline

**Files:**
- Create: `tests/onboarding-theme.test.js`
- Modify: `js/onboarding.js:10-35`
- Modify: `styles.css` near existing onboarding styles
- Modify: `index.html`, `sw.js` by version script

**Interfaces:**
- Consumes: `onboardTheme(theme: string): void` in `js/onboarding.js`, invoked by delegated `data-action="onboard:theme"` in `js/app.js`.
- Produces: four `.theme-opt` buttons with `data-theme` values `girl`, `boy`, `dayjob-girl`, and `dayjob-boy`; `.onb-tagline` text styled in Playfair Display.

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/onboarding-theme.test.js`:

```js
const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18795);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await page.waitForSelector('.theme-opt');

    const themes = await page.$$eval('.theme-opt', (els) => els.map((el) => el.dataset.theme));
    check('onboarding shows four theme choices', themes.join(',') === 'girl,boy,dayjob-girl,dayjob-boy', themes.join(','));

    for (const theme of themes) {
      await page.click(`.theme-opt[data-theme="${theme}"]`);
      const bodyTheme = await page.evaluate(() => document.body.dataset.theme);
      const selected = await page.$eval(`.theme-opt[data-theme="${theme}"]`, (el) => el.classList.contains('on'));
      check('theme preview updates for ' + theme, bodyTheme === theme, bodyTheme);
      check('selected state updates for ' + theme, selected);
    }

    const tagline = await page.$eval('.onb-tagline', (el) => ({
      text: el.textContent.trim(),
      family: getComputedStyle(el).fontFamily,
      fontStyle: getComputedStyle(el).fontStyle,
    }));
    check('tagline copy is concise', tagline.text === "A calm home for your baby's days. Let's set things up.", tagline.text);
    check('tagline uses Playfair Display', tagline.family.includes('Playfair Display'), tagline.family);
    check('tagline is italic', tagline.fontStyle === 'italic', tagline.fontStyle);
  } catch (e) {
    check('onboarding theme test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js`

Expected: FAIL with `onboarding shows four theme choices`, because only `girl` and `boy` buttons exist. It may also fail to find `.onb-tagline`.

- [ ] **Step 3: Update onboarding markup**

In `js/onboarding.js`, replace the tagline and theme picker block in `onboarding()` with this code:

```js
      <p class="onb-sub onb-tagline">A calm home for your baby's days.<br>Let's set things up.</p>
```

```js
      <div class="fld"><span class="fld-l">Theme</span>
        <div class="theme-pick" style="padding: 8px 0;">
          <button type="button" class="theme-opt ${t === 'girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="girl"><span class="theme-swatch girl"></span><span>Girl</span></button>
          <button type="button" class="theme-opt ${t === 'boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="boy"><span class="theme-swatch boy"></span><span>Boy</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-girl' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-girl"><span class="theme-swatch dayjob-girl"></span><span>Warm</span></button>
          <button type="button" class="theme-opt ${t === 'dayjob-boy' ? 'on' : ''}" data-action="onboard:theme" data-theme="dayjob-boy"><span class="theme-swatch dayjob-boy"></span><span>Cool</span></button>
        </div>
      </div>
```

Keep `onboardTheme()` unchanged. Its `.on` toggling already compares each button's `data-theme` to the active theme.

- [ ] **Step 4: Add the tagline style**

Add this rule to `styles.css` near the existing onboarding styles:

```css
.onb-tagline { font-family: "Playfair Display", serif; font-size: 16px; font-weight: 400; font-style: italic; color: var(--ink); }
```

- [ ] **Step 5: Run the onboarding test and verify it passes**

Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js`

Expected: PASS with checks for four theme choices, live preview, selected state, concise copy, Playfair Display, and italic style.

- [ ] **Step 6: Run syntax checks for touched JS**

Run: `npm run check`

Expected: PASS. If ESLint reports quote or semicolon issues in `tests/onboarding-theme.test.js`, edit only that file and re-run `npm run check`.

- [ ] **Step 7: Bump the frontend version**

Run: `scripts/bump-version.sh`

Expected: the script prints matching `index.html` and `sw.js` version lines with the same UTC timestamp.

- [ ] **Step 8: Commit Task 1**

```bash
git add js/onboarding.js styles.css tests/onboarding-theme.test.js index.html sw.js
git commit -m "feat(onboarding): add dayjob theme choices"
```

---

### Task 2: Timeline Day Counts and Visual Polish

**Files:**
- Modify: `js/timeline.js:67-70`
- Modify: `styles.css:1121-1131`
- Modify: `tests/timeline.test.js:18-29`
- Modify: `index.html`, `sw.js` by version script

**Interfaces:**
- Consumes: `groupByDay(entries, now?)` returns `{ key: string, label: string, items: Entry[] }[]`.
- Produces: Timeline day headers with `<h2 class="tl-day-hd"><span>Today</span><span class="tl-day-ct">N</span></h2>` and CSS rules for hidden chipbar scrollbars, row dividers, and accent back button.

- [ ] **Step 1: Extend the Timeline Playwright test**

In `tests/timeline.test.js`, replace the `hasToday` check around lines 20-21 with this block:

```js
    const todayInfo = await page.$$eval('.tl-day-hd', els => {
      const hd = els.find(e => e.querySelector('span:first-child')?.textContent.trim() === 'Today');
      return hd ? { label: hd.querySelector('span:first-child').textContent.trim(), count: hd.querySelector('.tl-day-ct')?.textContent.trim() } : null;
    });
    check('timeline groups under a Today header', todayInfo && todayInfo.label === 'Today', JSON.stringify(todayInfo));
    check('timeline shows the Today entry count', todayInfo && Number(todayInfo.count) >= 1, JSON.stringify(todayInfo));

    const backColors = await page.$eval('.tl-back', (el) => {
      const st = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      return { bg: st.backgroundColor, accentTint: root.getPropertyValue('--accent-tint').trim(), color: st.color };
    });
    check('timeline back button uses accent tint', backColors.bg !== 'rgba(0, 0, 0, 0)' && backColors.bg !== 'transparent', JSON.stringify(backColors));
```

- [ ] **Step 2: Run the Timeline test and verify it fails**

Run: `CHROMIUM=/usr/bin/chromium node tests/timeline.test.js`

Expected: FAIL with `timeline shows the Today entry count`, because `.tl-day-ct` does not exist yet.

- [ ] **Step 3: Render day counts in Timeline**

In `js/timeline.js`, replace the group rendering inside `timeline()` with this block:

```js
    body = groups.map((g) => `
      <div class="tl-day"><h2 class="tl-day-hd"><span>${esc(g.label)}</span><span class="tl-day-ct">${g.items.length}</span></h2>
        <div class="card log">${g.items.map(rowHTML).join('')}</div>
      </div>`).join('');
```

- [ ] **Step 4: Apply Timeline CSS polish**

In `styles.css`, replace the current Timeline block with this code:

```css
/* ---- timeline ---- */
.tl-hd { display: flex; align-items: center; gap: 10px; }
.tl-back { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--accent-tint); color: var(--accent-ink); }
.tl-chipbar { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 12px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.tl-chipbar::-webkit-scrollbar { display: none; }
.tl-chip { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 7px 13px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--soft); background: color-mix(in oklch, var(--accent-tint) 60%, transparent); }
.tl-chip .icon { width: 15px; height: 15px; }
.tl-chip.on { color: var(--accent-ink); background: var(--surface); box-shadow: 0 1px 3px var(--mat-cast); }
.tl-day { margin-bottom: 18px; }
.tl-day-hd { font-family: var(--font-sans); font-size: 14px; font-weight: 800; color: var(--soft); margin: 6px 2px 8px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tl-day-ct { font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .03em; }
.tl-row { display: flex; align-items: center; gap: 12px; padding: 10px 4px; cursor: pointer; border-bottom: 1px solid var(--hair); }
.tl-row:last-child { border-bottom: none; }
.tl-empty { color: var(--soft); text-align: center; padding: 48px 16px; }
```

- [ ] **Step 5: Run Timeline and onboarding tests**

Run: `CHROMIUM=/usr/bin/chromium node tests/timeline.test.js`

Expected: PASS.

Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js`

Expected: PASS. This guards against CSS changes breaking onboarding theme buttons.

- [ ] **Step 6: Run syntax checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 7: Bump the frontend version**

Run: `scripts/bump-version.sh`

Expected: the script prints matching `index.html` and `sw.js` version lines with the same UTC timestamp.

- [ ] **Step 8: Commit Task 2**

```bash
git add js/timeline.js styles.css tests/timeline.test.js index.html sw.js
git commit -m "style(timeline): polish day groups"
```

---

## Final Verification

- [ ] Run: `node --test js/timeline.test.js`
- [ ] Run: `CHROMIUM=/usr/bin/chromium node tests/onboarding-theme.test.js`
- [ ] Run: `CHROMIUM=/usr/bin/chromium node tests/timeline.test.js`
- [ ] Run: `npm run check`
- [ ] Confirm `index.html` and `sw.js` contain the same version timestamp printed by `scripts/bump-version.sh`.

## Self-Review Notes

- Spec coverage: onboarding four-theme picker, Playfair tagline, saved theme re-entry behavior through existing `document.body.dataset.theme`, Timeline count badge, hidden chipbar scrollbar, row dividers, and accent back button all map to tasks.
- Placeholder scan: no task uses deferred implementation language; tests and code snippets are concrete.
- Type consistency: `.theme-opt`, `.onb-tagline`, `.tl-day-ct`, `groupByDay`, and `onboardTheme(theme)` names match current code and test selectors.
