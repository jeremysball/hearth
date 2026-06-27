const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18794);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    // Log a couple of entries so the timeline has content.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(500);
    // Open the timeline from Home.
    await page.click('[data-action="nav:timeline"]');
    await page.waitForSelector('.tl-chipbar');
    check('timeline opens with a chip bar', true);
    const rows = await page.$$('.tl-row');
    check('timeline shows at least one row', rows.length >= 1, 'rows=' + rows.length);
    const hasToday = await page.$$eval('.tl-day-hd', els => els.some(e => e.textContent.trim() === 'Today'));
    check('timeline groups under a Today header', hasToday);
    // Filter to a type with no entries → filtered-empty state.
    await page.click('.tl-chip[data-type="note"]');
    await page.waitForSelector('.tl-empty');
    check('filtering to an absent type shows the filtered-empty state', true);
    // Back returns to Home.
    await page.click('.tl-chip[data-type="note"]'); // clear filter
    await page.waitForTimeout(300);
    await page.click('.tl-back');
    await page.waitForSelector('.actions');
    check('back returns to Home', true);
  } catch (e) {
    check('timeline test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
