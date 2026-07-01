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
  } catch (e) {
    check('overdue-labels test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });