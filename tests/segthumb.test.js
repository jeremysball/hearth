const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18791);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('.segctl');
    // Every segmented control's thumb must have non-zero width after first nav.
    const widthsAfterNav = await page.$$eval('.segctl .seg-thumb', els => els.map(e => e.getBoundingClientRect().width));
    check('all thumbs have width on first nav', widthsAfterNav.length > 0 && widthsAfterNav.every(w => w > 4), JSON.stringify(widthsAfterNav));
    // Toggle a different setting to force a refresh, then re-check.
    await page.click('.set-row .switch'); // first toggle on the profile page
    await page.waitForTimeout(200);
    const widthsAfterRefresh = await page.$$eval('.segctl .seg-thumb', els => els.map(e => e.getBoundingClientRect().width));
    check('all thumbs still have width after refresh', widthsAfterRefresh.every(w => w > 4), JSON.stringify(widthsAfterRefresh));
  } catch (e) {
    check('segthumb test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });