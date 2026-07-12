const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18808);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Clear the seeded sample history so there's no prior bottle to fall back to.
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      st.log = [];
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await onboard(page);

    // With no bottle logged yet, the form defaults the amount stepper to the
    // settings default (120).
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    const initialAmt = await page.$eval('#f-amt', (el) => el.dataset.value);
    check('bottle log form defaults amount to settings default (120) with no prior bottle', initialAmt === '120', initialAmt);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);
    // Opening the form saves a draft of its current values; clear it so the next
    // open reflects the logged bottle rather than this stale draft.
    await page.evaluate(() => sessionStorage.clear());

    // Log a bottle with a different amount.
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    await page.evaluate(() => {
      const el = document.getElementById('f-amt');
      el.dataset.value = '90';
      el.textContent = '90';
    });
    await page.click('[data-action="log:save"]');
    await page.waitForTimeout(300);
    await page.evaluate(() => sessionStorage.clear());

    // Re-opening the bottle log form now defaults the amount to the last
    // logged bottle's volume (90), not the unrelated settings default (120).
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    const updatedAmt = await page.$eval('#f-amt', (el) => el.dataset.value);
    check('bottle log form picks up the last logged bottle amount (90)', updatedAmt === '90', updatedAmt);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // bottleAmountDefault is stored in display units, not always ml. In oz
    // mode with no prior bottle, the fallback must read it as-is (4), not
    // divide it by 29.5735 as if it were ml.
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      st.log = [];
      st.settings.units.volume = 'oz';
      st.settings.bottleAmountDefault = 4;
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await onboard(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    const ozAmt = await page.$eval('#f-amt', (el) => el.dataset.value);
    check('oz-mode fallback reads bottleAmountDefault as display units (4), not ml', ozAmt === '4', ozAmt);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
