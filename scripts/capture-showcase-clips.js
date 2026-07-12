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
