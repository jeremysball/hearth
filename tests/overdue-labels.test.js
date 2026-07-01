const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18798);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Install the clock before navigation so every setInterval/setTimeout the
    // app creates is mocked and drivable via fastForward.
    await page.clock.install({ time: new Date('2026-06-30T08:00:00Z') });
    await page.goto(srv.base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await onboard(page);
    await page.waitForSelector('[data-card="bottle"]');

    // Log a bottle at the current (mocked) time. The form defaults to 120ml
    // and "Formula" — no spinner interaction needed, the save button picks
    // up the data-value attribute the stepper renders with.
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="log:save"]');
    await page.waitForTimeout(600);

    // Pre-overdue: label reads "Next bottle · every 3h".
    const freshLbl = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    check('fresh bottle shows "Next bottle · every 3h"', freshLbl === 'Next bottle · every 3h', freshLbl);

    // Jump 4h ahead. Bottle interval is 3h → overdue by 1h. fastForward fires
    // each mocked timer at most once; the 60s tick fires → router.refresh →
    // the overdue label renders.
    await page.clock.fastForward(4 * 3600 * 1000);
    await page.waitForTimeout(400);

    const overdueLbl = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    check('overdue bottle shows "Bottle due · 1h ago"', overdueLbl === 'Bottle due · 1h ago', overdueLbl);

    // Medicine card: Vitamin D (24h, never given → due = null → not overdue).
    const medLbl = await page.$eval('[data-card="medicine"] .ic-lbl', el => el.textContent.trim());
    check('never-given medicine still shows "Next medicine"', medLbl === 'Next medicine', medLbl);

    // ---- Live 15s tick ----
    // Mark the bottle card's .ic-lbl node with a probe attribute. The 15s
    // tick (refreshOverdueLabels) updates textContent in place, preserving
    // the node. The 60s tick (router.refresh) replaces #view innerHTML,
    // destroying the node and the probe. So if the probe survives the 45s
    // fastForward, no full re-render happened.
    await page.$eval('[data-card="bottle"] .ic-lbl', el => { el.dataset.probe = 'survives'; });
    const beforeTick = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    // fastForward 45s: the 15s interval fires once (next fire ~15s out from
    // the prior 4h jump); the 60s interval does NOT fire (next fire ~60s
    // out, beyond the 45s window). Only refreshOverdueLabels runs.
    await page.clock.fastForward(45 * 1000);
    await page.waitForTimeout(400);
    const afterTick = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.textContent.trim());
    const probeSurvived = await page.$eval('[data-card="bottle"] .ic-lbl', el => el.dataset.probe === 'survives').catch(() => false);
    check('15s tick advances overdue label', afterTick === 'Bottle due · 1h 1m ago' && afterTick !== beforeTick, `${beforeTick} → ${afterTick}`);
    check('15s tick does not full-re-render (node identity preserved)', probeSurvived, probeSurvived ? 'preserved' : 'node replaced');
  } catch (e) {
    check('overdue-labels test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });