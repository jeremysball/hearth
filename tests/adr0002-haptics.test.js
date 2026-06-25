// tests/adr0002-haptics.test.js — per-row haptic on spinner drag.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18791);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  // Mock navigator.vibrate before any app code runs.
  await page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(window.navigator, 'vibrate', {
      value: (ms) => { window.__vibrations.push(ms); return true; },
      configurable: true
    });
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // Open spinner via bottle log sheet.
  async function openSpinner() {
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(400);
    await page.click('.stepper-val');
    await page.waitForTimeout(300);
    return await page.$('.spinner-overlay');
  }
  async function closeOverlay() {
    await page.evaluate(() => {
      const o = document.querySelector('.spinner-overlay');
      if (o) { o._closed = true; o.classList.remove('show'); setTimeout(() => o.remove(), 200); }
      const s = document.querySelector('#scrim');
      if (s) { s.classList.remove('show'); setTimeout(() => { if (s) s.innerHTML = ''; }, 280); }
    });
    await page.waitForTimeout(350);
  }

  // ---------- per-row vibrate fires at 3ms ----------
  console.log('--- Haptics: per-row vibrate(3) on drag ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay = await openSpinner();
  const win = await (await overlay.$('.spinner-window')).boundingBox();
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;
  const itemH = (await (await overlay.$('.spinner-item')).boundingBox()).height;

  // Drag up exactly 3 item heights (3 rows) in small steps to ensure row-crossing events fire.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) {
    await page.mouse.move(cx, cy - i * itemH, { steps: 8 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);

  const vibs = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations recorded:', vibs);
  check('vibrate fired >= 3 times (once per row crossing)', vibs.length >= 3, vibs.length);
  check('all vibrations are 3ms (not 12ms long-press)', vibs.every(v => v === 3), vibs.join(','));
  await closeOverlay();

  // ---------- no vibrate on tap (no row crossing) ----------
  console.log('\n--- Haptics: no vibrate on tap-without-drag ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay2 = await openSpinner();
  const win2 = await (await overlay2.$('.spinner-window')).boundingBox();
  await page.mouse.move(win2.x + win2.width / 2, win2.y + win2.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const vibsTap = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations after tap:', vibsTap);
  check('no vibrate on tap', vibsTap.length === 0, vibsTap.length);
  await closeOverlay();

  // ---------- vibrate is bounded: fling across many rows produces discrete ticks ----------
  console.log('\n--- Haptics: fling fires per-row, not per-frame ---');
  await page.evaluate(() => { window.__vibrations = []; });
  const overlay3 = await openSpinner();
  const win3 = await (await overlay3.$('.spinner-window')).boundingBox();
  const cx3 = win3.x + win3.width / 2, cy3 = win3.y + win3.height / 2;
  await page.mouse.move(cx3, cy3 + 20);
  await page.mouse.down();
  await page.mouse.move(cx3, cy3 - 40, { steps: 2 });
  await page.mouse.move(cx3, cy3 - 200, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const flingVal = await page.$eval('.stepper-val', el => parseFloat(el.dataset.value));
  const vibsFling = await page.evaluate(() => window.__vibrations);
  const expectedRows = Math.round(Math.abs(flingVal - 120) / 5); // step=5, default=120
  console.log('  fling val:', flingVal, 'expected rows:', expectedRows, 'vibrations:', vibsFling.length);
  check('fling haptic count matches row count (within 1)', Math.abs(vibsFling.length - expectedRows) <= 1, `${vibsFling.length} vs ${expectedRows}`);
  await closeOverlay();

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
