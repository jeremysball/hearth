// tests/spinner.test.js — iOS-style drag-to-spin overlay behavior.
// Assumes a running Hearth server. Self-contained: starts its own server on
// plain HTTP so it can run in CI without TLS certs.

const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer();
  let exitCode = 0;
  try {
    exitCode = await runSuite(server.base);
  } catch (e) {
    console.error(e);
    exitCode = 1;
  } finally {
    server.close();
  }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await onboard(page);

  async function openSpinner() {
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(500);
    await page.click('.stepper-val');
    await page.waitForTimeout(300);
    return await page.$('.spinner-overlay');
  }

  async function closeOverlay() {
    await page.evaluate(() => {
      const o = document.querySelector('.spinner-overlay');
      if (o) { o._closed = true; o.classList.remove('show'); setTimeout(() => o.remove(), 200); }
      const scrim = document.querySelector('#scrim');
      if (scrim) { scrim.classList.remove('show'); setTimeout(() => { if (scrim) scrim.innerHTML = ''; }, 280); }
    });
    await page.waitForTimeout(350);
  }

  resetCounters();

  // ---------- Structure & alignment ----------
  console.log('--- Spinner: structure & alignment ---');
  const overlay = await openSpinner();
  const itemCount = await overlay.$$eval('.spinner-item', els => els.length);
  const itemTexts = await overlay.$$eval('.spinner-item', els => els.map(e => e.textContent));
  const onItems = await overlay.$$eval('.spinner-item.on', els => els.map(e => e.textContent));
  const highlightBox = await (await overlay.$('.spinner-highlight')).boundingBox();
  const itemBoxes = await overlay.$$eval('.spinner-item', els => els.map(e => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, cls: e.className };
  }));
  const selItem = itemBoxes.find(b => b.cls.includes('on'));
  const selCenter = selItem ? (selItem.top + selItem.bottom) / 2 : -1;
  const hiCenter = (highlightBox.y * 2 + highlightBox.height) / 2;

  check('item count is 11', itemCount === 11, 'got ' + itemCount);
  check('selected is 120', onItems[0] === '120', 'got ' + onItems[0]);
  check('selected aligns with highlight (<5px)', Math.abs(selCenter - hiCenter) < 5, 'delta ' + Math.abs(selCenter - hiCenter).toFixed(1));
  console.log('  items:', itemTexts);
  await closeOverlay();

  // ---------- Drag up: smooth multi-step settle ----------
  console.log('\n--- Spinner: drag up 100px (smooth settle) ---');
  const overlay2 = await openSpinner();
  const winBox = await (await overlay2.$('.spinner-window')).boundingBox();
  const cx = winBox.x + winBox.width / 2;
  const cy = winBox.y + winBox.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 100, { steps: 5 });
  await page.waitForTimeout(20);

  const duringOn = await overlay2.$$eval('.spinner-item.on', els => els.map(e => e.textContent));
  console.log('  during drag — selected:', duringOn);

  // Sample rAF frames during the settle animation
  await page.evaluate(() => {
    window.__vals = [];
    window.__rafId = requestAnimationFrame(function sample() {
      const el = document.querySelector('.spinner-item.on');
      window.__vals.push({ t: Date.now(), on: el?.textContent });
      if (window.__vals.length < 60) window.__rafId = requestAnimationFrame(sample);
    });
  });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const vals = await page.evaluate(() => window.__vals);
  const distinct = [...new Set(vals.filter(v => v.on).map(v => v.on))];
  const span = vals.length > 1 ? vals[vals.length - 1].t - vals[0].t : 0;
  check('settle animation >150ms', span > 150, span + 'ms');
  check('multiple distinct values during settle (>=2)', distinct.length >= 2, distinct.join('→'));
  const finalValue = await (await page.$('.stepper-val')).getAttribute('data-value');
  check('final snaped to step', Number(finalValue) % 5 === 0, finalValue);
  await closeOverlay();

  // ---------- Heavy fling: momentum carries multiple steps ----------
  console.log('\n--- Spinner: heavy fling up (momentum) ---');
  const overlay3 = await openSpinner();
  const w3 = await (await overlay3.$('.spinner-window')).boundingBox();
  const cx3 = w3.x + w3.width / 2;
  const cy3 = w3.y + w3.height / 2;
  await page.mouse.move(cx3, cy3 + 30);
  await page.mouse.down();
  await page.mouse.move(cx3, cy3 - 30, { steps: 3 });
  await page.mouse.move(cx3, cy3 - 240, { steps: 6 });
  await page.waitForTimeout(5);
  await page.mouse.up();
  await page.waitForTimeout(700);

  const flingVal = await (await page.$('.stepper-val')).getAttribute('data-value');
  const flingItems = await overlay3.$$eval('.spinner-item', els => els.map(e => e.textContent));
  const flingOn = await overlay3.$$eval('.spinner-item.on', els => els.map(e => e.textContent));
  console.log('  fling final value:', flingVal, 'items:', flingItems);
  check('fling moved up (>=135)', Number(flingVal) >= 135, flingVal);
  check('fling snapped to step', Number(flingVal) % 5 === 0, flingVal);
  check('fling selected matches stepper', flingOn[0] === flingVal, flingOn[0] + ' vs ' + flingVal);
  await closeOverlay();

  // ---------- Boundary: heavy drag past min, no negatives ----------
  console.log('\n--- Spinner: drag past min (boundary) ---');
  const overlay4 = await openSpinner();
  const w4 = await (await overlay4.$('.spinner-window')).boundingBox();
  const cx4 = w4.x + w4.width / 2;
  const cy4 = w4.y + w4.height / 2;
  await page.mouse.move(cx4, cy4);
  await page.mouse.down();
  for (let y = 0; y <= 2000; y += 200) {
    await page.mouse.move(cx4, cy4 + y, { steps: 3 });
    await page.waitForTimeout(5);
  }
  await page.waitForTimeout(100);
  const bItems = await overlay4.$$eval('.spinner-item', els => els.map(e => e.textContent));
  const bOn = await overlay4.$$eval('.spinner-item.on', els => els.map(e => e.textContent));
  console.log('  at boundary drag — items:', bItems, 'selected:', bOn);
  check('no negatives during drag', !bItems.some(t => parseFloat(t) < 0));
  await page.mouse.up();
  await page.waitForTimeout(800);
  const finalStepper = await (await page.$('.stepper-val')).getAttribute('data-value');
  const finalOn = await overlay4.$$eval('.spinner-item.on', els => els.map(e => e.textContent));
  console.log('  final — stepper:', finalStepper, 'selected:', finalOn);
  check('final value at min (0)', parseFloat(finalStepper) === 0, finalStepper);
  check('no negatives in final', !finalOn.some(t => parseFloat(t) < 0));
  await closeOverlay();

  // ---------- Tap without drag: no value change ----------
  console.log('\n--- Spinner: tap without drag ---');
  const overlay5 = await openSpinner();
  const w5 = await (await overlay5.$('.spinner-window')).boundingBox();
  const cx5 = w5.x + w5.width / 2;
  const cy5 = w5.y + w5.height / 2;
  await page.mouse.move(cx5, cy5);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const tapVal = await (await page.$('.stepper-val')).getAttribute('data-value');
  console.log('  value after tap:', tapVal);
  check('tap keeps value at 120', tapVal === '120', tapVal);
  await closeOverlay();

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}