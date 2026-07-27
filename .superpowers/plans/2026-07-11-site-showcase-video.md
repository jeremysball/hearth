# Animated Showcase Clips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two static screenshots in the marketing site's "Day / night · same log" showcase with short looping muted video clips captured from the real running app.

**Architecture:** A one-off Playwright script drives the Go dev server to record two raw `.webm` clips (day: two-tap bottle log; night: idle hero card with ticking timer, dark theme). `ffmpeg` transcodes each to a size-optimized webm (VP9) + mp4 (H.264) pair. The canonical files land in a new repo-root `videos/` directory (tracked in git, same convention as `screenshots/`), and `scripts/stage-site-assets.sh` copies them into `site/videos/` for local preview and the Pages deploy, exactly how it already handles `screenshots/`. `site/index.html` swaps its two `<img>` tags for `<video autoplay muted loop playsinline>` with the original screenshot as `poster`, and reduced-motion visitors get the poster only (video never plays).

**Tech Stack:** Playwright (already a dev dependency at repo root), ffmpeg (present on this machine), no new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-11-site-showcase-video-design.md` (approved).
- Each final clip file must be under ~1.5MB.
- No audio in any clip.
- `prefers-reduced-motion: reduce` visitors must see the static poster only, never autoplaying video (extends the existing `reduceMotion` check in `site/index.html`'s inline script).
- Canonical video assets live in repo-root `videos/` and are committed to git (same pattern as `screenshots/`), not directly under `site/`.
- `site/videos/` itself is populated by `scripts/stage-site-assets.sh`, not committed directly (mirrors `site/screenshots/`).
- Bump the app's version (`scripts/bump-version.sh`) is **not** required for this work — it only touches `site/`, `videos/`, and `scripts/stage-site-assets.sh`, none of which are cached PWA assets (`js/`, root `index.html`, `styles.css`, `sw.js`, `assets/`, `icons/`).
- No changes to `js/changelog.js` — marketing-site-only change, not an app change.
- Follow Conventional Commits for every commit message.

---

### Task 1: Capture raw day and night clips with Playwright

**Files:**
- Create: `scripts/capture-showcase-clips.js`

**Interfaces:**
- Consumes: a running Hearth dev server (light/dark theme via `state().settings.darkMode`, onboarding flow, home screen `data-card="bottle"` log card, `data-action="log:save"` save button — all existing app surface, no app code changes).
- Produces: two raw video files, printed to stdout as absolute paths, consumed by Task 2.

- [ ] **Step 1: Write the capture script**

```js
// Captures two raw, untrimmed video clips of the running app for the
// marketing site's showcase section: a "day" clip (two-tap bottle log,
// light theme) and a "night" clip (idle hero card, ticking timer, dark
// theme). Raw output goes through ffmpeg in a separate step (see
// docs/superpowers/plans/2026-07-11-site-showcase-video.md Task 2) before
// landing in videos/.
//
// Usage (server must already be running, see docs/codebase-quickref.md or
// the `run` skill for how to launch one):
//   BASE_URL=https://localhost:9878 OUT_DIR=/tmp/showcase-clips node scripts/capture-showcase-clips.js
//
// Env vars (all optional):
//   BASE_URL  dev server origin            (default https://localhost:9878)
//   OUT_DIR   directory for raw-*.webm      (default /tmp/showcase-clips)
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL || 'https://localhost:9878';
const OUT_DIR = process.env.OUT_DIR || '/tmp/showcase-clips';
const VIEWPORT = { width: 390, height: 844 };

fs.mkdirSync(OUT_DIR, { recursive: true });

async function onboard(p) {
  await p.goto(BASE_URL + '/');
  await p.waitForTimeout(800);
  await p.fill('input[placeholder="e.g. Olive"]', 'Olive');
  await p.fill('input[type="date"]', '2025-01-15');
  await p.click('text=Girl');
  await p.fill('input[placeholder="e.g. Maya"]', 'Maya');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(300);
  await p.click('.btn-primary');
  await p.waitForTimeout(1200);
}

// Seeds the same-origin localStorage state a fresh onboarded page would
// have, so a video-recording context can `goto` straight into a
// pre-onboarded home screen instead of showing the onboarding form on
// camera.
async function captureStorageState(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const p = await context.newPage();
  await onboard(p);
  const statePath = path.join(OUT_DIR, `storage-state-day-${Date.now()}.json`);
  await context.storageState({ path: statePath });
  await context.close();
  return statePath;
}

// Same as captureStorageState, but also switches to dark mode and seeds an
// awake elapsed time of 260 minutes (twilight-leaning sky per
// scripts/sky-phases.js's elapsedMin>=260 boundary) so the night clip shows
// a dark-themed hero card with a live nap-window prediction.
async function captureNightStorageState(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const p = await context.newPage();
  await onboard(p);
  await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hearth.state.v1'));
    raw.settings.darkMode = 'dark';
    const now = Date.now();
    raw.log = raw.log.filter((e) => e.type !== 'sleep');
    raw.log.unshift({
      id: 'seed-sleep-showcase',
      type: 'sleep',
      start: new Date(now - 260 * 60000 - 90 * 60000).toISOString(),
      end: new Date(now - 260 * 60000).toISOString(),
    });
    localStorage.setItem('hearth.state.v1', JSON.stringify(raw));
  });
  const statePath = path.join(OUT_DIR, `storage-state-night-${Date.now()}.json`);
  await context.storageState({ path: statePath });
  await context.close();
  return statePath;
}

async function recordClip(browser, { name, storageStatePath, run }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
    storageState: storageStatePath,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  });
  const p = await context.newPage();
  await p.goto(BASE_URL + '/');
  await p.waitForTimeout(1500); // let the home screen settle before recording "starts" visually
  await run(p);
  const video = p.video();
  await context.close();
  const recordedPath = await video.path();
  const finalPath = path.join(OUT_DIR, `raw-${name}.webm`);
  fs.renameSync(recordedPath, finalPath);
  console.log(name, '->', finalPath);
  return finalPath;
}

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });

  // Day clip: light theme (default), two-tap bottle log.
  const dayState = await captureStorageState(browser);
  await recordClip(browser, {
    name: 'day',
    storageStatePath: dayState,
    run: async (p) => {
      await p.click('[data-card="bottle"][data-action="log:open"]');
      await p.waitForTimeout(700);
      await p.click('[data-action="log:save"]');
      await p.waitForTimeout(2200); // confetti + toast + sheet close settle
      await p.waitForTimeout(800); // final hold on the settled home screen
    },
  });

  // Night clip: dark theme, baby awake ~4h20m, no interaction — just let
  // the hero timer tick and the sky's ambient particles animate.
  const nightState = await captureNightStorageState(browser);
  await recordClip(browser, {
    name: 'night',
    storageStatePath: nightState,
    run: async (p) => {
      await p.waitForTimeout(5000); // ticking timer + ambient sky motion
    },
  });

  await browser.close();
})();
```

- [ ] **Step 2: Start a dev server for the capture**

Run (from repo root, following the `run` skill):

```bash
REPO=/workspace/hearth
CERT=$(ls $REPO/certs/*.crt | head -1)
KEY=${CERT%.crt}.key
cd $REPO
PORT=9879 STATIC_DIR=$REPO DB_PATH=/tmp/hearth-showcase.db CERT_FILE=$CERT KEY_FILE=$KEY PEPPER=$(openssl rand -hex 32) go run ./cmd/hearth &
sleep 4
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:9879/
```

Expected: `200`.

- [ ] **Step 3: Run the capture script**

```bash
BASE_URL=https://localhost:9879 OUT_DIR=/tmp/showcase-clips node scripts/capture-showcase-clips.js
```

Expected output: two lines, `day -> /tmp/showcase-clips/raw-day.webm` and `night -> /tmp/showcase-clips/raw-night.webm`.

- [ ] **Step 4: Verify the raw clips look right**

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/showcase-clips/raw-day.webm
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/showcase-clips/raw-night.webm
```

Expected: both durations roughly 4-6 seconds (day: ~5.2s from the wait budget in Step 1; night: ~6.5s from the 1.5s settle + 5s hold). If either file is missing or near-zero duration, the recording failed — check that Step 2's server is reachable and re-run Step 3.

- [ ] **Step 5: Kill the dev server**

```bash
pkill -f "go run ./cmd/hearth" || true
```

- [ ] **Step 6: Commit**

```bash
git add scripts/capture-showcase-clips.js
git commit -m "feat(site): add Playwright script to capture showcase clip footage"
```

---

### Task 2: Transcode raw clips into optimized webm + mp4

**Files:**
- Create: `videos/showcase-day.webm`, `videos/showcase-day.mp4`, `videos/showcase-night.webm`, `videos/showcase-night.mp4`

**Interfaces:**
- Consumes: `/tmp/showcase-clips/raw-day.webm` and `/tmp/showcase-clips/raw-night.webm` from Task 1.
- Produces: the four final asset files Task 3's markup references at `videos/showcase-{day,night}.{webm,mp4}`.

- [ ] **Step 1: Create the videos directory**

```bash
mkdir -p videos
```

- [ ] **Step 2: Transcode the day clip**

```bash
ffmpeg -y -i /tmp/showcase-clips/raw-day.webm \
  -vf "scale=390:-2,fps=24" -an \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 \
  videos/showcase-day.webm

ffmpeg -y -i /tmp/showcase-clips/raw-day.webm \
  -vf "scale=390:-2,fps=24" -an \
  -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
  videos/showcase-day.mp4
```

- [ ] **Step 3: Transcode the night clip**

```bash
ffmpeg -y -i /tmp/showcase-clips/raw-night.webm \
  -vf "scale=390:-2,fps=24" -an \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 \
  videos/showcase-night.webm

ffmpeg -y -i /tmp/showcase-clips/raw-night.webm \
  -vf "scale=390:-2,fps=24" -an \
  -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart \
  videos/showcase-night.mp4
```

- [ ] **Step 4: Verify file sizes are within budget**

```bash
ls -la videos/showcase-day.webm videos/showcase-day.mp4 videos/showcase-night.webm videos/showcase-night.mp4
```

Expected: every file under 1.5MB (roughly 1,572,864 bytes). If any file is over budget, re-run its `ffmpeg` command with `-crf` raised by 4-6 (e.g. `-crf 38` for VP9, `-crf 30` for H.264) — higher CRF means smaller, lower-quality output — until it fits, then re-check.

- [ ] **Step 5: Spot-check playback**

```bash
ffprobe -v error -show_entries stream=width,height,codec_name,duration -of default=noprint_wrappers=1 videos/showcase-day.mp4
```

Expected: `width=390`, a `codec_name` of `h264`, and a duration matching the raw clip.

- [ ] **Step 6: Commit**

```bash
git add videos/
git commit -m "feat(site): add optimized showcase video assets"
```

---

### Task 3: Wire the video clips into the marketing site

**Files:**
- Modify: `site/index.html:883-898` (showcase section markup)
- Modify: `site/index.html:363-368` (`.plate img` CSS rule)
- Modify: `site/index.html` inline script, near line 967 (`reduceMotion` check)
- Modify: `scripts/stage-site-assets.sh`

**Interfaces:**
- Consumes: `videos/showcase-{day,night}.{webm,mp4}` from Task 2; existing `screenshots/readme-hero-{light,dark}.png` as `poster` (already staged by the existing script logic).
- Produces: none consumed by later tasks — this is the last content task.

- [ ] **Step 1: Extend the CSS rule to cover `<video>` the same way it covers `<img>`**

In `site/index.html`, find:

```css
  .plate img {
    width: 100%;
    border-radius: 16px;
    display: block;
    box-shadow: 0 4px 14px oklch(0.2 0.03 40 / 0.22);
  }
```

Replace with:

```css
  .plate img, .plate video {
    width: 100%;
    border-radius: 16px;
    display: block;
    box-shadow: 0 4px 14px oklch(0.2 0.03 40 / 0.22);
  }
```

- [ ] **Step 2: Replace the two `<img>` tags with `<video>`**

Find:

```html
  <section class="showcase" data-time="07:40" aria-label="Screenshots">
    <div class="wrap">
      <p class="eyebrow-mono">Day / night · same log</p>
      <div class="plates">
        <figure class="plate plate-day">
          <img src="screenshots/readme-hero-light.png" alt="Hearth's hero card in daylight, showing an awake timer and nap window prediction">
          <figcaption><b>Day</b> awake timer · nap window</figcaption>
        </figure>
        <figure class="plate plate-night">
          <img src="screenshots/readme-hero-dark.png" alt="Hearth's hero card at night, showing an awake timer and nap window prediction">
          <figcaption><b>Night</b> offline log</figcaption>
        </figure>
      </div>
      <p class="showcase-caption">The hero card tracks awake time and predicts the next nap window. Logging a bottle takes two taps.</p>
    </div>
  </section>
```

Replace with:

```html
  <section class="showcase" data-time="07:40" aria-label="Screenshots">
    <div class="wrap">
      <p class="eyebrow-mono">Day / night · same log</p>
      <div class="plates">
        <figure class="plate plate-day">
          <video class="plate-video" width="390" height="844" muted loop playsinline
                 poster="screenshots/readme-hero-light.png"
                 aria-label="Hearth's hero card in daylight: logging a bottle in two taps">
            <source src="videos/showcase-day.webm" type="video/webm">
            <source src="videos/showcase-day.mp4" type="video/mp4">
          </video>
          <figcaption><b>Day</b> awake timer · nap window</figcaption>
        </figure>
        <figure class="plate plate-night">
          <video class="plate-video" width="390" height="844" muted loop playsinline
                 poster="screenshots/readme-hero-dark.png"
                 aria-label="Hearth's hero card at night, showing an awake timer and nap window prediction">
            <source src="videos/showcase-night.webm" type="video/webm">
            <source src="videos/showcase-night.mp4" type="video/mp4">
          </video>
          <figcaption><b>Night</b> offline log</figcaption>
        </figure>
      </div>
      <p class="showcase-caption">The hero card tracks awake time and predicts the next nap window. Logging a bottle takes two taps.</p>
    </div>
  </section>
```

Note: no `autoplay` attribute — Step 3 starts playback from JS so reduced-motion visitors can be skipped cleanly.

- [ ] **Step 3: Start playback from JS, gated on `prefers-reduced-motion`**

In `site/index.html`, find the line (near line 967):

```js
      var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

Immediately after it, add:

```js
      if (!reduceMotion) {
        document.querySelectorAll('.plate-video').forEach(function (v) { v.play().catch(function () {}); });
      }
```

(The `.catch(function () {})` swallows a rejected autoplay promise on browsers with stricter autoplay policies — the poster frame just stays visible instead of throwing an unhandled rejection.)

- [ ] **Step 4: Extend the asset-staging script to copy the video files**

In `scripts/stage-site-assets.sh`, find:

```bash
mkdir -p site/screenshots
cp icons/icon-512.png site/icon.png
cp screenshots/readme-hero-light.png site/screenshots/readme-hero-light.png
cp screenshots/readme-hero-dark.png site/screenshots/readme-hero-dark.png
echo "Staged icon.png and screenshots/ into site/"
```

Replace with:

```bash
mkdir -p site/screenshots site/videos
cp icons/icon-512.png site/icon.png
cp screenshots/readme-hero-light.png site/screenshots/readme-hero-light.png
cp screenshots/readme-hero-dark.png site/screenshots/readme-hero-dark.png
cp videos/showcase-day.webm site/videos/showcase-day.webm
cp videos/showcase-day.mp4 site/videos/showcase-day.mp4
cp videos/showcase-night.webm site/videos/showcase-night.webm
cp videos/showcase-night.mp4 site/videos/showcase-night.mp4
echo "Staged icon.png, screenshots/, and videos/ into site/"
```

- [ ] **Step 5: Stage the assets and verify locally**

```bash
bash scripts/stage-site-assets.sh
ls site/videos/
```

Expected: `showcase-day.mp4  showcase-day.webm  showcase-night.mp4  showcase-night.webm`.

- [ ] **Step 6: Commit**

```bash
git add site/index.html scripts/stage-site-assets.sh
git commit -m "feat(site): swap showcase screenshots for looping video clips"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing — this is the final gate before the branch is considered done.

- [ ] **Step 1: Serve the staged site locally**

```bash
cd site && python3 -m http.server 8935 >/tmp/site-server.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8935/
```

Expected: `200`.

- [ ] **Step 2: Screenshot both plates with Playwright and confirm they render**

```js
// run from repo root: node /tmp/verify-showcase.js
const { chromium } = require('/workspace/hearth/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto('http://localhost:8935/');
  await p.waitForTimeout(2000);
  await p.locator('.showcase').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1000);
  await p.locator('.showcase .plates').screenshot({ path: '/tmp/showcase-plates.png' });
  const playing = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.plate-video')).map((v) => !v.paused && v.currentTime > 0)
  );
  console.log('playing:', playing);
  await b.close();
})();
```

```bash
node /tmp/verify-showcase.js
```

Expected: `playing: [ true, true ]`. Then read `/tmp/showcase-plates.png` and visually confirm both plates show video frames (not broken-media icons) and look consistent with the surrounding page.

- [ ] **Step 3: Confirm reduced-motion visitors don't autoplay**

```js
// run from repo root: node /tmp/verify-reduced-motion.js
const { chromium } = require('/workspace/hearth/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto('http://localhost:8935/');
  await p.waitForTimeout(1500);
  const playing = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.plate-video')).map((v) => !v.paused)
  );
  console.log('playing under reduced motion:', playing);
  await b.close();
})();
```

```bash
node /tmp/verify-reduced-motion.js
```

Expected: `playing under reduced motion: [ false, false ]`.

- [ ] **Step 4: Confirm total payload weight**

```bash
du -ch site/videos/*.webm site/videos/*.mp4 | tail -1
```

Expected: total under ~6MB (four files, ~1.5MB budget each from Task 2).

- [ ] **Step 5: Stop the local server**

```bash
pkill -f "http.server 8935" || true
```

- [ ] **Step 6: Clean up temp verification scripts**

```bash
rm -f /tmp/verify-showcase.js /tmp/verify-reduced-motion.js /tmp/showcase-plates.png
```

No commit for this task — it's verification only, no file changes.
