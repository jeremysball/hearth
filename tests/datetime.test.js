const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18792);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('#f-time');
    const val = await page.$eval('#f-time', el => el.value);
    // datetime-local value must be a full YYYY-MM-DDTHH:MM, date portion non-empty.
    check('sleep sheet #f-time has a full datetime value', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val), val);
  } catch (e) {
    check('datetime test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
