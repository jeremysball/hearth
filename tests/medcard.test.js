const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18793);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.waitForSelector('[data-card="medicine"]');

    // Default state has one medicine (Vitamin D). Tapping the card logs a dose directly.
    await page.click('[data-action="med:card"]');
    await page.waitForTimeout(400);
    const toast1 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('single medicine logs dose directly with toast', toast1);

    // Add a second medicine to test the multi-medicine picker.
    await page.click('[data-action="card:edit"][data-card="medicine"]');
    await page.waitForSelector('#med-list', { timeout: 3000 });
    check('manage form opens via edit button', true);

    await page.click('[data-action="med:add"]');
    await page.fill('#med-list .med-edit:last-child .med-name', 'Ibuprofen');
    await page.click('[data-action="card:save-meds"]');
    await page.waitForTimeout(300);

    // Now 2 meds: tapping the card opens the dose picker.
    await page.click('[data-action="med:card"]');
    await page.waitForSelector('[data-action="med:dose"]', { timeout: 3000 });
    check('multi-medicine shows dose picker', true);

    // Pick the first dose option.
    await page.click('[data-action="med:dose"]');
    await page.waitForTimeout(300);
    const toast2 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('dose picker logs with a toast', toast2);
  } catch (e) {
    check('medcard test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
