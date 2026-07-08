const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18796);
  const browser = await launchBrowser();
  try {
    // Onboard the one family this instance will ever have, then mint a
    // real invite token the same way the admin UI does.
    const setupPage = await browser.newPage();
    await setupPage.goto(srv.base + '/');
    await onboard(setupPage);
    const token = await setupPage.evaluate(async () => {
      const res = await fetch('/api/invites', { method: 'POST', credentials: 'include' });
      const body = await res.json();
      return body.token;
    });
    await setupPage.close();

    // A second, unauthenticated browser context opens the invite link.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(srv.base + '/join/' + token);
    await page.waitForSelector('[data-action="join:google"]');
    const googleBtn = await page.$('[data-action="join:google"]');
    check('join page shows a Continue with Google button', !!googleBtn, 'missing');

    // Capture the intermediate request to /api/auth/google directly so the
    // assertion is environment-independent (works whether or not
    // GOOGLE_CLIENT_ID is set in the test env).
    const reqPromise = page.waitForRequest((r) => r.url().includes('/api/auth/google'), { timeout: 5000 }).catch(() => null);
    await page.click('[data-action="join:google"]');
    const req = await reqPromise;
    check('Continue with Google navigates to /api/auth/google with the invite token', !!req && req.url().includes('invite=' + token), req ? req.url() : page.url());

    await context.close();
  } catch (e) {
    check('join-invite-google test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
