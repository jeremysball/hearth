// tests/adr0002-ptr.test.js — pull-to-refresh gesture.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18793);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

// Dispatch a touch pointer event on the .screen element.
async function touchPtrEvent(page, type, clientX, clientY, pointerId = 1) {
  await page.evaluate(({ type, clientX, clientY, pointerId }) => {
    const screen = document.querySelector('.screen');
    if (!screen) return;
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true,
      pointerType: 'touch', clientX, clientY, pointerId
    });
    screen.dispatchEvent(e);
  }, { type, clientX, clientY, pointerId });
}

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  // Mock navigator.vibrate + fetch mock for /api/sync (page.route/unroute are unreliable
  // with this Chromium build, so we intercept fetch in-page via __syncMode).
  await page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(window.navigator, 'vibrate', {
      value: (ms) => { window.__vibrations.push(ms); return true; },
      configurable: true
    });
    window.__syncMode = 'passthrough';
    window.__syncCalled = false;
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      // In 'hang' mode, freeze ALL fetches so drainOutbox can't return early
      // and trigger ptrCollapse before the test checks ptr-spinning.
      if (window.__syncMode === 'hang') return new Promise(() => {});
      if (u.includes('/api/sync')) {
        window.__syncCalled = true;
        if (window.__syncMode === 'fulfill') {
          return Promise.resolve(new Response(
            JSON.stringify({ serverTime: '', log: [], growth: [], baby: null, settings: null }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        }
      }
      return origFetch.call(this, url, opts);
    };
  });

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // Navigate to trends — any tab works, PTR is global.
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(200);

  // ---------- #ptr indicator exists in DOM ----------
  console.log('--- PTR: DOM structure ---');
  const ptrExists = await page.$('#ptr') !== null;
  check('#ptr element exists in DOM', ptrExists);
  if (!ptrExists) {
    tally();
    await browser.close();
    return 1;
  }

  // ---------- Short pull (below threshold): indicator appears, no vibration, no sync ----------
  console.log('\n--- PTR: short pull below threshold collapses without sync ---');
  await page.evaluate(() => { window.__vibrations = []; window.__syncCalled = false; window.__syncMode = 'passthrough'; });

  // Get screen center for dispatch coordinates.
  const screenBox = await page.$eval('.screen', el => {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + 40 };
  });
  const { cx, cy } = screenBox;

  // The #ptr element is revealed via inline transform: translateY(dist - PTR_WRAP_H)
  // (PTR_WRAP_H = 92). style.height is never set, so we parse the translateY value
  // out of the inline transform. Collapsed = -92 (or empty inline → CSS translateY(-100%)).
  // The transform is driven by requestAnimationFrame inside ptrUpdate(), so we poll
  // briefly rather than read once — a single read can race the frame in headless Chromium.
  const readPtrY = () => page.$eval('#ptr', el => {
    const m = (el.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
    return m ? parseFloat(m[1]) : -92;
  });
  async function pollPtrY(pred, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    let y = await readPtrY();
    while (Date.now() < deadline && !pred(y)) {
      await page.waitForTimeout(20);
      y = await readPtrY();
    }
    return y;
  }

  // Pull 30px (below PTR_THRESHOLD of 70px).
  await touchPtrEvent(page, 'pointerdown', cx, cy, 1);
  await touchPtrEvent(page, 'pointermove', cx, cy + 20, 1);
  await touchPtrEvent(page, 'pointermove', cx, cy + 30, 1);
  const ptrYAt30 = await pollPtrY(y => y > -92);
  console.log('  #ptr translateY at 30px raw pull:', ptrYAt30);
  check('#ptr has positive height during short pull', ptrYAt30 > -92, ptrYAt30);

  await touchPtrEvent(page, 'pointerup', cx, cy + 30, 1);
  await page.waitForTimeout(400);

  const ptrYAfter = await page.$eval('#ptr', el => {
    const m = (el.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
    return m ? parseFloat(m[1]) : -92;
  });
  const vibsShort = await page.evaluate(() => window.__vibrations);
  const syncCalledShort = await page.evaluate(() => window.__syncCalled);
  console.log('  #ptr translateY after release:', ptrYAfter, 'vibrations:', vibsShort, 'sync called:', syncCalledShort);
  check('#ptr collapses to 0 after below-threshold release', ptrYAfter <= 0, ptrYAfter);
  check('no vibration on below-threshold pull', vibsShort.length === 0, vibsShort.length);
  check('no sync on below-threshold pull', !syncCalledShort);

  // ---------- Full pull past threshold: vibrate(12) fires once, sync called ----------
  console.log('\n--- PTR: full pull past threshold triggers sync ---');
  await page.evaluate(() => { window.__vibrations = []; window.__syncCalled = false; window.__syncMode = 'fulfill'; });

  // Pull 120px raw → dist = 40 + (120-40)*0.5 = 80 > threshold (70), so armed.
  await page.evaluate(() => { window.__vibrations = []; });
  await touchPtrEvent(page, 'pointerdown', cx, cy, 2);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 2);
    await page.waitForTimeout(15);
  }
  const vibsAtThreshold = await page.evaluate(() => window.__vibrations);
  console.log('  vibrations while pulling (should be 1 at threshold crossing):', vibsAtThreshold);
  check('vibrate(12) fires exactly once at threshold crossing', vibsAtThreshold.length === 1 && vibsAtThreshold[0] === 12, vibsAtThreshold.join(','));

  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 2);
  await page.waitForTimeout(400);
  const syncCalledFull = await page.evaluate(() => window.__syncCalled);
  check('sync triggered after full pull release', syncCalledFull);

  // Indicator should collapse after sync
  await page.waitForTimeout(500);
  const ptrYPost = await page.$eval('#ptr', el => {
    const m = (el.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
    return m ? parseFloat(m[1]) : -92;
  });
  check('#ptr collapses to 0 after sync completes', ptrYPost <= 0, ptrYPost);

  // ---------- PTR does not fire when screen is scrolled down ----------
  console.log('\n--- PTR: no trigger when screen is scrolled ---');
  await page.evaluate(() => { window.__vibrations = []; });
  // Navigate to home which has a longer log (or just scroll via evaluate)
  await page.evaluate(() => {
    const screen = document.querySelector('.screen');
    if (screen) screen.scrollTop = 50;
  });
  await page.waitForTimeout(100);

  await touchPtrEvent(page, 'pointerdown', cx, cy, 3);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 3);
  }
  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 3);
  await page.waitForTimeout(300);
  const ptrYWhenScrolled = await page.$eval('#ptr', el => {
    const m = (el.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
    return m ? parseFloat(m[1]) : -92;
  });
  console.log('  #ptr translateY when screen scrolled (should be <=0):', ptrYWhenScrolled);
  check('#ptr does not trigger when screen is scrolled', ptrYWhenScrolled <= 0, ptrYWhenScrolled);

  // Reset scroll
  await page.evaluate(() => { const s = document.querySelector('.screen'); if (s) s.scrollTop = 0; });

  // ---------- Timeout: hanging sync collapses indicator within 4.5s ----------
  console.log('\n--- PTR: timeout collapses indicator if sync hangs ---');
  await page.evaluate(() => { window.__vibrations = []; window.__syncMode = 'hang'; });

  await touchPtrEvent(page, 'pointerdown', cx, cy, 4);
  for (let dy = 0; dy <= 120; dy += 15) {
    await touchPtrEvent(page, 'pointermove', cx, cy + dy, 4);
    await page.waitForTimeout(10);
  }
  await touchPtrEvent(page, 'pointerup', cx, cy + 120, 4);
  await page.waitForTimeout(200);

  const ptrSpinning = await page.evaluate(() => document.getElementById('ptr')?.classList.contains('ptr-spinning'));
  console.log('  ptr-spinning class present while sync hangs:', ptrSpinning);
  check('#ptr has ptr-spinning class while sync is in-flight', ptrSpinning);

  // Wait past the 4s timeout
  await page.waitForTimeout(4400);
  const ptrAfterTimeout = await page.$eval('#ptr', el => {
    const m = (el.style.transform || '').match(/translateY\(([-0-9.]+)px\)/);
    return {
      y: m ? parseFloat(m[1]) : -92,
      spinning: el.classList.contains('ptr-spinning')
    };
  });
  console.log('  #ptr after 4.4s timeout:', ptrAfterTimeout);
  check('#ptr collapses after 4s timeout', ptrAfterTimeout.y <= 0, ptrAfterTimeout.y);
  check('ptr-spinning class removed after timeout', !ptrAfterTimeout.spinning);

  const exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
