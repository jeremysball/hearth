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

    // auth=denied shows a toast and does not crash.
    await page.goto(srv.base + '/?auth=denied');
    await page.waitForTimeout(400);
    const deniedToast = await page.locator('#toast').innerText().catch(() => '');
    check('auth=denied shows an invite-link toast', deniedToast.includes('invite link'), deniedToast);

    // auth=mismatch opens a real recovery sheet with two concrete actions.
    await page.goto(srv.base + '/?auth=mismatch&provider=google');
    await page.waitForSelector('[data-action="auth:mismatch-switch"]');
    const switchBtn = await page.$('[data-action="auth:mismatch-switch"]');
    const dismissBtn = await page.$('[data-action="auth:mismatch-dismiss"]');
    check('auth=mismatch shows a switch action', !!switchBtn, 'missing');
    check('auth=mismatch shows a dismiss action', !!dismissBtn, 'missing');
  } catch (e) {
    check('account test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
