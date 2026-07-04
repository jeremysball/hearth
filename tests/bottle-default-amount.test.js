const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18808);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Bottle log form defaults the amount stepper to the settings default (120).
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    const initialAmt = await page.$eval('#f-amt', (el) => el.dataset.value);
    check('bottle log form defaults amount to 120', initialAmt === '120', initialAmt);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);
    // Opening the form saves a draft of its current values; clear it so the next
    // open reflects the new settings default rather than this stale draft.
    await page.evaluate(() => sessionStorage.clear());

    // Edit the bottle card's settings and change the default amount.
    await page.click('[data-action="card:edit"][data-card="bottle"]');
    await page.waitForSelector('#c-amt');
    await page.evaluate(() => {
      const el = document.getElementById('c-amt');
      el.dataset.value = '180';
      el.textContent = '180';
    });
    await page.click('[data-action="card:save-bottle"]');
    await page.waitForTimeout(300);

    const savedDefault = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.settings.bottleAmountDefault;
    });
    check('bottleAmountDefault persists to 180', savedDefault === 180, savedDefault);

    // Re-opening the bottle log form now defaults the amount to the new value.
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-amt');
    const updatedAmt = await page.$eval('#f-amt', (el) => el.dataset.value);
    check('bottle log form picks up the new default (180)', updatedAmt === '180', updatedAmt);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
