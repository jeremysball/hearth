// Captures a screenshot of the hero sky scene in each of its seven modes
// (morning, day, golden, twilight, night, deep-night, newborn) against a
// running dev server. Useful whenever js/sky.js changes and you want a full
// before/after comparison instead of eyeballing one scene at a time.
//
// Usage (server must already be running, see docs/codebase-quickref.md or
// the `run` skill for how to launch one):
//   BASE_URL=https://localhost:9878 OUT_DIR=/tmp node scripts/sky-phases.js
//
// Env vars (all optional):
//   BASE_URL  dev server origin            (default https://localhost:9878)
//   OUT_DIR   directory for phase-*.png     (default /tmp)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL || 'https://localhost:9878';
const OUT_DIR = process.env.OUT_DIR || '/tmp';

async function onboard(p, birthdate = '2025-01-15') {
  await p.goto(BASE_URL + '/');
  await p.waitForTimeout(800);
  await p.fill('input[placeholder="e.g. Olive"]', 'Olive');
  await p.fill('input[type="date"]', birthdate);
  await p.click('text=Girl');
  await p.fill('input[placeholder="e.g. Maya"]', 'Maya');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(300);
  await p.click('.btn-primary');
  await p.waitForTimeout(1200);
}

// Wake-window mode boundaries (elapsed minutes since last wake) were probed
// empirically for the default 18-month test baby: morning <=60, day ~120,
// golden ~180-220, twilight >=260. Re-probe if wake-window math changes.
async function setAwakeElapsed(p, elapsedMin) {
  await p.evaluate((mins) => {
    const raw = JSON.parse(localStorage.getItem('hearth.state.v1'));
    const now = Date.now();
    raw.log = raw.log.filter((e) => e.type !== 'sleep');
    raw.log.unshift({
      id: 'seed-sleep', type: 'sleep',
      start: new Date(now - mins * 60000 - 90 * 60000).toISOString(),
      end: new Date(now - mins * 60000).toISOString(),
    });
    localStorage.setItem('hearth.state.v1', JSON.stringify(raw));
  }, elapsedMin);
  await p.reload();
  await p.waitForTimeout(1200);
}

async function setAsleep(p, minsAgo = 20) {
  await p.evaluate((mins) => {
    const raw = JSON.parse(localStorage.getItem('hearth.state.v1'));
    const now = Date.now();
    raw.log = raw.log.filter((e) => e.type !== 'sleep');
    raw.log.unshift({
      id: 'seed-sleep-asleep', type: 'sleep',
      start: new Date(now - mins * 60000).toISOString(),
      end: null,
    });
    localStorage.setItem('hearth.state.v1', JSON.stringify(raw));
  }, minsAgo);
  await p.reload();
  await p.waitForTimeout(1200);
}

async function shot(p, name) {
  await p.locator('.card.hero.hero-sky').screenshot({ path: path.join(OUT_DIR, `phase-${name}.png`) });
  const mode = await p.evaluate(() => document.querySelector('.hero-sky')?.dataset.skyMode);
  console.log(name, '->', mode);
}

(async () => {
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });

  // 18mo baby: morning/day/golden/twilight/night
  {
    const p = await b.newPage();
    await p.setViewportSize({ width: 390, height: 500 });
    // Pin the clock to mid-afternoon: sceneSpec's circadian "night" flag
    // (8pm-6am, real wall clock) would otherwise force every mode below to
    // night whenever this script happens to run in the evening.
    const afternoon = new Date();
    afternoon.setHours(14, 0, 0, 0);
    await p.clock.install({ time: afternoon });
    await onboard(p);

    await setAwakeElapsed(p, 15);
    await shot(p, '1-morning');

    await setAwakeElapsed(p, 120);
    await shot(p, '2-day');

    await setAwakeElapsed(p, 200);
    await shot(p, '3-golden');

    await setAwakeElapsed(p, 300);
    await shot(p, '4-twilight');

    await setAsleep(p, 20);
    await shot(p, '5-night');

    await p.close();
  }

  // deep-night: fixed clock at 3am, asleep
  {
    const p = await b.newPage();
    await p.setViewportSize({ width: 390, height: 500 });
    const deepNight = new Date();
    deepNight.setHours(3, 15, 0, 0);
    await p.clock.install({ time: deepNight });
    await onboard(p);
    await setAsleep(p, 20);
    await shot(p, '6-deep-night');
    await p.close();
  }

  // newborn: birthdate 20 days ago
  {
    const p = await b.newPage();
    await p.setViewportSize({ width: 390, height: 500 });
    // Same circadian-night guard as the first block above: pin an afternoon
    // clock so the newborn scene isn't clobbered by the real-time night flag.
    const afternoon = new Date();
    afternoon.setHours(14, 0, 0, 0);
    await p.clock.install({ time: afternoon });
    const bd = new Date(afternoon.getTime() - 20 * 86400000).toISOString().slice(0, 10);
    await onboard(p, bd);
    await setAwakeElapsed(p, 30);
    await shot(p, '7-newborn');
    await p.close();
  }

  await b.close();
})();
