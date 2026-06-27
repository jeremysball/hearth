const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18795);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('#account-sec');
    const pills = await page.$$('.signin-pill');
    check('profile shows two sign-in pills when anonymous', pills.length === 2, 'pills=' + pills.length);
    // auth=error redirect is handled with a toast, not a crash.
    await page.goto(srv.base + '/?auth=error');
    await page.waitForTimeout(400);
    const urlClean = !page.url().includes('auth=');
    check('auth query param is cleared from the URL', urlClean, page.url());
  } catch (e) {
    check('account test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
