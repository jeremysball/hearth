const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18796);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('[data-action="dev:tap-version"]');

    const tapAndReadToast = async () => {
      await page.click('[data-action="dev:tap-version"]');
      await page.waitForTimeout(80);
      const el = await page.$('#toast.show span');
      return el ? await el.textContent() : null;
    };

    const firstTapToast = await tapAndReadToast();
    check('first tap shows no progress toast', firstTapToast === null, String(firstTapToast));

    const secondTapToast = await tapAndReadToast();
    check('second tap shows "8 more times"', secondTapToast === 'Press 8 more times to enable developer mode', secondTapToast);

    for (let i = 0; i < 6; i++) await tapAndReadToast();
    const ninthTapToast = await tapAndReadToast();
    check('ninth tap shows singular "1 more time"', ninthTapToast === 'Press 1 more time to enable developer mode', ninthTapToast);

    const tenthTapToast = await tapAndReadToast();
    check('tenth tap enables developer mode', tenthTapToast === 'Developer mode enabled', tenthTapToast);

    const devMode = await page.evaluate(() => localStorage.getItem('hearth.devMode'));
    check('dev mode flag persisted', devMode === '1', devMode);

    await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
    const eleventhTapToast = await tapAndReadToast();
    check('tapping again once enabled shows nothing', eleventhTapToast === null, String(eleventhTapToast));
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
