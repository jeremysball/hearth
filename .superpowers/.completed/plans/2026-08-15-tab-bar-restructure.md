# Tab-Bar Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the day-log (Timeline) from a Home-card link to its own bottom tab, and merge the Trends and Growth tabs into a single "Insights" tab that shows both on one long scroll (Trends first, then Growth), keeping Sleep as its own tab.

**Architecture:** `js/timeline.js`'s `timeline()` view function already exists and is already wired into `VIEWS` and reachable via `router.go('timeline')` (it's currently reached only via a Home-card link, not a tab). This plan adds it to `TABS`, adds a new `insights` view that concatenates the existing, unmodified `trends()` and `growth()` render functions, updates the router's per-view entry-animation dispatch to call both view-entry animation hooks when `insights` is entered, removes the old Home → Timeline link, and updates the two Playwright specs that currently trigger Trends/Growth animations via now-removed nav actions.

**Tech Stack:** Vanilla JS, no framework. Tests: `node --test js/store.test.js` (unit), Playwright specs under `tests/`.

**Spec:** `.superpowers/specs/2026-08-15-dogfood-solids-nav-design.md`, Section 2 ("Tab-bar restructure")

## Global Constraints

- No change to Trends' or Growth's own internal content, charts, or insight cards — only their container and navigation entry point change. Their render functions (`trends()`, `growth()`) keep their exact current signatures and output.
- `TABS` count stays at 5.
- Icons: `insights` keeps `chart-bar`. `sleep`/`home`/`profile` icons unchanged. `timeline` gets a new icon distinct from `chart-bar`, added to the SVG sprite in `index.html`.
- Follow Conventional Commits. Run `scripts/bump-version.sh` before the closing commit. Add a changelog entry under today's dated block in `js/changelog.js` (this is a user-facing navigation change — a `feat` entry, e.g. "Timeline and Insights are now their own tabs").

---

### Task 1: Add the `timeline` icon to the SVG sprite

**Files:**
- Modify: `index.html` (the inline SVG `<symbol>` sprite, alongside the existing symbols around line 233-244, e.g. after `chevron-down`/before `refresh-cw`)

**Interfaces:**
- Consumes: nothing.
- Produces: a new `<symbol id="scroll-text" ...>` (or whichever Lucide icon name is chosen — see Step 1) usable via `<svg class="icon"><use href="#scroll-text"></use></svg>`, same pattern every other sprite icon already uses.

- [ ] **Step 1: Get the canonical Lucide SVG source for the chosen icon**

The project's icon rule (`CLAUDE.md`) is "Lucide icons only, vendored locally as an inline SVG sprite in `index.html`." Do not hand-write or approximate the `<path>` geometry from memory — pull the exact path data from a canonical Lucide source (e.g. `npx lucide-static@latest` output, or the vendored `lucide` package already used elsewhere in this repo's tooling if one exists — check `package.json`/`node_modules` first) for the `scroll-text` icon (a list/log icon, per the spec). If `scroll-text` isn't available or doesn't read well at the app's icon size, `list` or `notebook-text` are reasonable Lucide fallbacks — pick whichever renders clearly at ~20px and is visually distinct from `chart-bar` (already used by `insights`).

- [ ] **Step 2: Add the `<symbol>` to the sprite**

Match the existing stroke-icon format exactly (see `chevron-down` at `index.html:236` for the template): `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`, with the icon's own `<path>`/`<line>`/etc. children pulled verbatim from the Lucide source.

- [ ] **Step 3: Verify the symbol renders**

Run the app locally (`npx http-server -p 8080 -a 0.0.0.0` or the project's existing dev-serve command — check the README) and visually confirm `<svg class="icon"><use href="#scroll-text"></use></svg>` (or the chosen id) renders a visible icon somewhere temporarily (e.g. paste it into any existing view briefly, then remove — or just inspect it in devtools by editing the DOM live). This is a quick visual sanity check, not an automated test.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(icons): vendor the timeline tab icon"
```

---

### Task 2: Add a merged `insights` view that renders Trends then Growth

**Files:**
- Create: `js/insights.js`
- Modify: `js/app.js` (imports, `VIEWS`, `TABS`, the `enterTrends`/`enterSleep`/`enterGrowth` dispatch block in `router.go`)

**Interfaces:**
- Consumes: `trends` from `js/trends.js` (`export function trends()`, no args, returns an HTML string), `growth` from `js/growth.js` (`export function growth()`, no args, returns an HTML string) — both unchanged.
- Produces: `insights()` — a new exported function from `js/insights.js`, no args, returns an HTML string. Later tasks (none in this plan) don't depend on anything further from this module.

- [ ] **Step 1: Create the `insights` view module**

```js
// insights.js: merged Trends + Growth view, one long scroll (Trends first).
import { trends } from './trends.js';
import { growth } from './growth.js';

export function insights() {
  return `<div class="insights-view">${trends()}${growth()}</div>`;
}
```

(`insights-view` is a plain wrapper div for any future container-level styling; the scroll container itself is unaffected since `.screen` already handles the scrolling flex column per `styles.css:181`.)

Note: `trends()` and `growth()` each render their own `.page-hd`/`<h1 class="page-title">` header, so the merged view will show two page headers ("Trends" then "Growth") in one scroll rather than a single "Insights" header — this is a deliberate consequence of the spec's "each section keeps its own internal markup/styling unchanged" requirement (Section 2), not an oversight. Confirm this reads fine visually in Task 2's manual check below before treating it as final; if it looks wrong in practice, that's a design call for a follow-up, not a blocker for this task.

- [ ] **Step 2: Wire `insights` into `app.js`'s imports, `VIEWS`, and `TABS`**

In `js/app.js`, `enterTrends()`/`enterGrowth()` (~lines 35-69) are local functions that query `#view` directly by CSS selector — they do NOT reference the imported `trends`/`growth` functions themselves (only `VIEWS` does, and only `showGrowthStat` from `growth.js` is used elsewhere, at the `growth:showstat` action handler). Once `trends`/`growth` are dropped from `VIEWS`, both bare imports become genuinely unused and must be removed, or the app fails its `node --check`/lint step. Change:

```js
import { trends } from './trends.js';
...
import { growth, showGrowthStat } from './growth.js';
```

to:

```js
import { showGrowthStat } from './growth.js';
```

(Drop the `trends` import line entirely — `insights.js` imports `trends` itself and app.js has no other use for it.)

Add the new import:

```js
import { insights } from './insights.js';
```

Change `VIEWS`:

```js
const VIEWS = { home, trends, sleep, growth, profile, timeline };
```

to:

```js
const VIEWS = { home, sleep, insights, profile, timeline };
```

Change `TABS`:

```js
const TABS = [
  { v: 'home', icon: 'house', label: 'Home' }, { v: 'sleep', icon: 'moon', label: 'Sleep' },
  { v: 'trends', icon: 'chart-bar', label: 'Trends' }, { v: 'growth', icon: 'ruler', label: 'Growth' },
  { v: 'profile', icon: 'user', label: 'Profile' }
];
```

to:

```js
const TABS = [
  { v: 'home', icon: 'house', label: 'Home' }, { v: 'sleep', icon: 'moon', label: 'Sleep' },
  { v: 'timeline', icon: 'scroll-text', label: 'Timeline' }, { v: 'insights', icon: 'chart-bar', label: 'Insights' },
  { v: 'profile', icon: 'user', label: 'Profile' }
];
```

(Use whichever icon id Task 1 actually settled on for `timeline` if it differs from `scroll-text`.)

- [ ] **Step 3: Update the view-entry animation dispatch**

In `router.go`, find:

```js
    if (view === 'trends') enterTrends();
    else if (view === 'sleep') enterSleep();
    else if (view === 'growth') enterGrowth();
```

Replace with:

```js
    if (view === 'insights') { enterTrends(); enterGrowth(); }
    else if (view === 'sleep') enterSleep();
```

`enterTrends()`/`enterGrowth()` (defined above `router` in the same file, ~lines 35-69) keep their exact current bodies — both already query `#view` for the relevant elements (`.bar`, `.ringwrap svg circle`, `.growth-svg polyline/polygon/circle`) and animate whatever they find, so calling both unconditionally on `insights` entry animates both sections correctly without any change to either function.

- [ ] **Step 3.5: Sweep for any other `trends`/`growth` reference this task's file list doesn't cover**

Run `rg -n "trends|growth" --glob '!*.md' --glob '!*.test.js'` from the repo root and check every hit outside `js/trends.js`/`js/growth.js`/`js/insights.js` themselves (e.g. `js/ui.js`'s `TYPES`, `js/timeline.js`'s `FILTER_TYPES`) for a stale `'trends'`/`'growth'` view-name string this task missed. Test-file hits are handled separately in Task 5.

- [ ] **Step 4: Remove the now-dead `nav:trends`/`nav:growth` action handlers, add `nav:insights`**

Find the action-handler map (~`app.js:211-226`):

```js
    'nav:home': () => router.go('home'),
    'nav:trends': () => router.go('trends'),
    'nav:sleep': () => router.go('sleep'),
    'nav:growth': () => router.go('growth'),
```

Replace the `nav:trends`/`nav:growth` lines with a single:

```js
    'nav:insights': () => router.go('insights'),
```

leaving `nav:home`, `nav:sleep`, `nav:timeline` (already present at `app.js:226`), and `nav:profile` untouched.

- [ ] **Step 5: Run a router smoke check before the unit suite**

This task's risk is a broken module graph (a bad import or a `VIEWS`/`TABS` typo throws at parse time, blanking the whole app) that `js/store.test.js` alone won't catch since it never touches `app.js`/`router.go`. First run `node --check js/app.js js/insights.js` to confirm both parse. Then load the app locally (`npx http-server -p 8080 -a 0.0.0.0` or the project's dev-serve command) and manually click through all 5 tabs (`home`/`sleep`/`timeline`/`insights`/`profile`) confirming each renders without a blank screen or console error, and that tapping Insights shows both the Trends charts and the Growth stat grid/chart on one scroll.

- [ ] **Step 6: Run the unit tests**

Run: `node --test js/store.test.js`
Expected: PASS (this task touches no `store.js` logic, but confirms nothing else broke on import)

- [ ] **Step 7: Commit**

```bash
git add js/insights.js js/app.js
git commit -m "feat(nav): merge Trends and Growth into a single Insights view"
```

---

### Task 3: Promote Timeline to a bottom tab, remove the Home-card link

**Files:**
- Modify: `js/home.js:507` (the Today card's "Timeline" link)

**Interfaces:**
- Consumes: nothing new — `nav:timeline` already exists as an action (`app.js:226`, unchanged by this plan) and `timeline` is already a `VIEWS` entry.
- Produces: nothing new.

- [ ] **Step 1: Remove the Home Today-card Timeline link**

In `js/home.js`, find:

```js
      <div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : `<a data-action="nav:timeline">Timeline</a>`}</div>
```

Change to remove the link entirely, keeping the edit-mode "Done" affordance:

```js
      <div class="today-hd"><h2>Today</h2>${todayEditMode ? `<a data-action="today:edit-done">Done</a>` : ''}</div>
```

The bottom `timeline` tab (added in Task 2) is now the only path to the day-log view, per the spec.

- [ ] **Step 2: Manual check**

Load the app locally, confirm the Today card header shows no link when not in edit mode, and confirm tapping the Timeline tab still opens the day-log view correctly (this exercises the existing, unmodified `nav:timeline` → `router.go('timeline')` → `VIEWS.timeline` path, which Task 2 didn't touch).

- [ ] **Step 3: Commit**

```bash
git add js/home.js
git commit -m "feat(nav): remove Home's Timeline link now that it's a bottom tab"
```

---

### Task 4: Update `profile.js`'s stale "Growth tab" copy

**Files:**
- Modify: `js/profile.js:126`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Update the copy**

Find:

```js
      <p class="empty-note">Used to calculate growth percentiles on the Growth tab.</p>
```

Change to:

```js
      <p class="empty-note">Used to calculate growth percentiles on the Insights tab.</p>
```

- [ ] **Step 2: Commit**

```bash
git add js/profile.js
git commit -m "docs(profile): update stale Growth-tab copy to Insights"
```

---

### Task 5: Update the two Playwright specs that drive Trends/Growth animations via the old nav actions

**Files:**
- Modify: `tests/adr0002-animations.test.js` (5 occurrences: lines 46, 71, 104, 124, 153)
- Modify: `tests/adr0002-ptr.test.js` (1 occurrence: line 74)

**Interfaces:**
- Consumes: the `nav:insights` action added in Task 2.
- Produces: nothing new.

- [ ] **Step 1: Replace every `nav:trends`/`nav:growth` click with `nav:insights`**

In both files, every `await page.click('[data-action="nav:trends"]');` and `await page.click('[data-action="nav:growth"]');` becomes `await page.click('[data-action="nav:insights"]');`.

Read each surrounding block first. A click on `nav:insights` now triggers both `enterTrends()` and `enterGrowth()` unconditionally (Task 2, Step 3), so both the bar-chart family (`.bar`) and the growth-chart family (`.growth-svg polyline`/`polygon`/`circle`) animate together on every Insights entry, including a `router.refresh()`-triggered one. `tests/adr0002-animations.test.js:122-135` specifically asserts that a `refresh()` does NOT replay animations — before this change that assertion only checked the bar family (since `refresh()` on the old `growth` view called `enterGrowth()` alone); after this change it must check that **neither** family replays, so extend that assertion to also read `.growth-svg circle`'s animation-related class/attribute state, not just `.bar`. Don't blindly swap the click target and leave the assertion scoped to whichever family the original test happened to check — that would still pass even if the other family's refresh-guard broke (a green test proving nothing about the code it's meant to cover).

- [ ] **Step 2: Run both specs**

Run: `CHROMIUM=/usr/bin/chromium node tests/run.js` (or the project's documented single-file invocation — check `package.json`'s `test`/`test:e2e` scripts for the exact command before running) scoped to these two files, or the full suite if no file-scoping option exists. Confirm both pass. `tests/run.js` defaults to `CONCURRENCY=1` — do not override it (project rule: never run Playwright suites in parallel).

- [ ] **Step 3: Commit**

```bash
git add tests/adr0002-animations.test.js tests/adr0002-ptr.test.js
git commit -m "test(nav): update Trends/Growth animation specs for the merged Insights tab"
```

---

### Task 6: Bump version, changelog, and finish the branch

**Files:**
- Modify: `index.html`, `sw.js` (via `scripts/bump-version.sh`)
- Modify: `js/changelog.js`

- [ ] **Step 1: Add a changelog entry**

Add a `feat` entry to today's dated block in `js/changelog.js`, e.g. "Timeline now has its own tab, and Trends + Growth are combined into one Insights tab." Match the file's existing entry format.

- [ ] **Step 2: Bump the version**

```bash
scripts/bump-version.sh
```

- [ ] **Step 3: Run the unit suite**

Run: `node --test js/store.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add js/changelog.js index.html sw.js
git commit -m "chore(nav): bump version and changelog for tab-bar restructure"
```

- [ ] **Step 5: Open the PR**

Use `superpowers:finishing-a-development-branch`. Title e.g. `feat(nav): promote Timeline to a tab, merge Trends+Growth into Insights`. Reference the spec section. Because this touches `app.js` broadly (router logic, tab bar shell), rely on CI's full Playwright matrix as the primary gate per project convention, rather than the full local suite — but do run the two specs from Task 5 locally first since they're directly affected. Get review at effort level `medium` (navigation/router change, moderate blast radius, but no data-model risk) before merging.
