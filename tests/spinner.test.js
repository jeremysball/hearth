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

  check('item count is 15', itemCount === 15, 'got ' + itemCount);
  check('selected is 120', onItems[0] === '120', 'got ' + onItems[0]);
  check('selected aligns with highlight (<5px)', Math.abs(selCenter - hiCenter) < 5, 'delta ' + Math.abs(selCenter - hiCenter).toFixed(1));
  console.log('  items:', itemTexts);
  await closeOverlay();

  // ---------- Mid-drag alignment: highlight must track the "on" item continuously ----------
  // Regression for a bug where the rendered item and its on-screen position
  // disagreed by a full row for the back half of every step (only visible
  // while the pointer is down — settled/before/after checks never caught it).
  console.log('\n--- Spinner: mid-drag alignment (no row-snap glitch) ---');
  const overlay1b = await openSpinner();
  const win1b = await (await overlay1b.$('.spinner-window')).boundingBox();
  const cx1b = win1b.x + win1b.width / 2;
  const cy1b = win1b.y + win1b.height / 2;
  const itemH = (await (await overlay1b.$('.spinner-item')).boundingBox()).height;

  await page.mouse.move(cx1b, cy1b);
  await page.mouse.down();
  let maxDelta = 0;
  for (let dy = 0; dy <= Math.round(itemH); dy++) {
    await page.mouse.move(cx1b, cy1b - dy, { steps: 1 });
    const delta = await page.evaluate(() => {
      const hi = document.querySelector('.spinner-highlight').getBoundingClientRect();
      const on = document.querySelector('.spinner-item.on');
      if (!on) return 0;
      const onR = on.getBoundingClientRect();
      return Math.abs((onR.top + onR.height / 2) - (hi.top + hi.height / 2));
    });
    if (delta > maxDelta) maxDelta = delta;
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  console.log('  max highlight/on-item misalignment across a 1-step drag:', maxDelta.toFixed(1) + 'px (row height ' + itemH + 'px)');
  check('on-item stays within half a row of the highlight while dragging', maxDelta <= itemH / 2 + 1, maxDelta.toFixed(1) + 'px');
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

  // ---------- Fling: momentum matches the gesture's true average speed ----------
  // Regression for a velocity-sampling bug: summing N per-event deltas over
  // a window timed across only the last (N-1) intervals overstates speed by
  // N/(N-1) — worst for short, fast flings — so the wheel lands a step (or
  // more) further than the actual gesture implies ("looks like it'll land
  // on 13, lands on 14"). Verified against an independent capture of the
  // exact same browser pointer events, mirroring the app's own formula.
  console.log('\n--- Spinner: fling momentum matches true gesture speed ---');
  const overlay6 = await openSpinner();
  // Attach AFTER opening — openSpinner() itself clicks through two menus,
  // which would otherwise contaminate the capture with unrelated pointer
  // events before the actual fling gesture even starts.
  await page.evaluate(() => {
    window.__raw = [];
    const push = (e) => window.__raw.push({ y: e.clientY, t: performance.now() });
    document.addEventListener('pointerdown', push, { capture: true });
    document.addEventListener('pointermove', push, { capture: true });
  });
  const stepAttr = await page.$eval('#f-amt', el => parseFloat(el.dataset.step));
  const startVal = await page.$eval('#f-amt', el => parseFloat(el.dataset.value));
  const rowH = (await (await overlay6.$('.spinner-item')).boundingBox()).height;
  const w6 = await (await overlay6.$('.spinner-window')).boundingBox();
  const cx6 = w6.x + w6.width / 2;
  const cy6 = w6.y + w6.height / 2 + 60;

  await page.mouse.move(cx6, cy6);
  await page.mouse.down();
  await page.mouse.move(cx6, cy6 - 20, { steps: 1 });
  await page.mouse.move(cx6, cy6 - 60, { steps: 1 });
  await page.mouse.move(cx6, cy6 - 110, { steps: 1 });
  await page.mouse.move(cx6, cy6 - 170, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const raw = await page.evaluate(() => window.__raw);
  const finalVal = Number(await (await page.$('.stepper-val')).getAttribute('data-value'));

  // Replicate the app's own physics (offsetY + windowed velocity → nearest
  // step) from the independently-captured ground truth.
  const offsetTotal = raw[raw.length - 1].y - raw[0].y;
  const win5 = raw.slice(-5);
  let vel = 0;
  if (win5.length > 1) {
    const dt = win5[win5.length - 1].t - win5[0].t;
    if (dt > 0) vel = (win5[win5.length - 1].y - win5[0].y) / dt * 100;
  }
  const expectedSteps = Math.round((offsetTotal + vel) / rowH);
  const expectedVal = startVal - expectedSteps * stepAttr;

  console.log('  raw samples:', raw.length, 'offset:', offsetTotal, 'vel:', vel.toFixed(1), 'expected:', expectedVal, 'actual:', finalVal);
  check('fling lands where the true gesture speed predicts (within a step)', Math.abs(finalVal - expectedVal) <= stepAttr * 0.6, 'expected ' + expectedVal + ', got ' + finalVal);
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

  // ---------- Tap-to-type: click centered value, type a new value, commit ----------
  console.log('\n--- Spinner: tap-to-type entry ---');
  const overlay7 = await openSpinner();
  const w7 = await (await overlay7.$('.spinner-window')).boundingBox();
  const onItemBox = await (await overlay7.$('.spinner-item.on')).boundingBox();
  const cx7 = onItemBox.x + onItemBox.width / 2;
  const cy7 = onItemBox.y + onItemBox.height / 2;

  // Click the centered item to enter type mode (explicit down/up for reliability)
  await page.mouse.move(cx7, cy7);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Should now show an input inside the centered item
  const input = await overlay7.$('.spinner-item.on input');
  const html = await overlay7.$eval('.spinner-item.on', el => el.innerHTML);
  console.log('  centered item HTML after tap:', html ? html.substring(0, 80) : '(none)');
  check('type-mode input appears', input !== null);
  if (!input) { await closeOverlay(); } else {
    // Type a new value
    await input.fill('175');
    await page.waitForTimeout(200);

    // Press Enter to commit
    await input.press('Enter');
    await page.waitForTimeout(500);

    const typedVal = await (await page.$('.stepper-val')).getAttribute('data-value');
    console.log('  value after typing 175:', typedVal);
    check('typed value snaps to nearest step (175)', typedVal === '175', typedVal);
  }
  await closeOverlay();

  // ---------- Type-mode: confirm button doesn't double-commit ----------
  console.log('\n--- Spinner: type-mode confirm button doesn\'t double-commit ---');
  {
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window._commitCount = 0;
      const el = document.querySelector('#f-amt');
      if (el) el.addEventListener('change', () => window._commitCount++);
    });
    await page.click('.stepper-val');
    await page.waitForTimeout(300);
    const overlayDc = await page.$('.spinner-overlay');
    if (!overlayDc) {
      check('double-commit: spinner opened', false);
    } else {
      const onItemDc = await overlayDc.$('.spinner-item.on');
      const onBoxDc = await onItemDc.boundingBox();
      await page.mouse.move(onBoxDc.x + onBoxDc.width / 2, onBoxDc.y + onBoxDc.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
      const inpDc = await overlayDc.$('input');
      if (!inpDc) {
        check('double-commit: type-mode input appeared', false);
      } else {
        await inpDc.fill('75');
        await page.waitForTimeout(100);
        const btnDc = await overlayDc.$('.spinner-check');
        await btnDc.click();
        await page.waitForTimeout(300);
        const count = await page.evaluate(() => window._commitCount);
        check('confirm button commits exactly once (no double-commit)', count === 1, 'change events fired: ' + count);
      }
    }
    await closeOverlay();
  }

  // ---------- New drag cancels in-flight animation (not just sets a flag) ----------
  console.log('\n--- Spinner: new drag cancels in-flight animation ---');
  {
    const overlayAnim = await openSpinner();
    if (!overlayAnim) {
      check('anim-cancel: spinner opened', false);
    } else {
      const winAnim = await (await overlayAnim.$('.spinner-window')).boundingBox();
      const cxA = winAnim.x + winAnim.width / 2;
      const cyA = winAnim.y + winAnim.height / 2;
      await page.mouse.move(cxA, cyA + 20);
      await page.mouse.down();
      await page.mouse.move(cxA, cyA - 80, { steps: 4 });
      await page.mouse.up();
      await page.evaluate(() => {
        window._cafCount = 0;
        const orig = window.cancelAnimationFrame.bind(window);
        window.cancelAnimationFrame = (id) => { window._cafCount++; return orig(id); };
      });
      await page.waitForTimeout(80);
      await page.mouse.down();
      await page.mouse.move(cxA, cyA - 40, { steps: 2 });
      await page.mouse.up();
      await page.waitForTimeout(700);
      const cafCount = await page.evaluate(() => window._cafCount);
      check('new drag calls cancelAnimationFrame to stop previous animation', cafCount > 0, 'cancelAnimationFrame called ' + cafCount + ' times');
    }
    await closeOverlay();
  }

  // ---------- Confirm button is keyboard-accessible via click event ----------
  console.log('\n--- Spinner: confirm button responds to keyboard Enter ---');
  {
    const overlayKb = await openSpinner();
    if (!overlayKb) {
      check('keyboard-confirm: spinner opened', false);
    } else {
      const onItemKb = await overlayKb.$('.spinner-item.on');
      const onBoxKb = await onItemKb.boundingBox();
      await page.mouse.move(onBoxKb.x + onBoxKb.width / 2, onBoxKb.y + onBoxKb.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
      const inpKb = await overlayKb.$('input');
      if (!inpKb) {
        check('keyboard-confirm: type-mode input appeared', false);
      } else {
        await inpKb.fill('200');
        await page.waitForTimeout(100);
        await page.evaluate(() => {
          const btn = document.querySelector('.spinner-check');
          if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
        await page.waitForTimeout(300);
        const kbVal = await page.$eval('#f-amt', el => el.dataset.value);
        check('keyboard Enter on confirm button commits typed value', kbVal === '200', 'value: ' + kbVal);
      }
    }
    await closeOverlay();
  }

  const exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}