const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18814);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await page.waitForSelector('.sex-opt');

    const sexes = await page.$$eval('.sex-opt', (els) => els.map((el) => el.dataset.sex));
    check('onboarding shows two sex choices', sexes.join(',') === 'girl,boy', sexes.join(','));

    await page.fill('#onb-name', 'Test Baby');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(300);
    const stillOnboarding = await page.$('#onb-name');
    check('finishing without a sex choice does not complete onboarding', !!stillOnboarding);
    const groupShaken = await page.$eval('.sex-opt', (el) => el.closest('.theme-pick').classList.contains('shake'));
    check('the sex picker shakes when required and missing', groupShaken);

    await page.click('.sex-opt[data-sex="boy"]');
    const selected = await page.$eval('.sex-opt[data-sex="boy"]', (el) => el.classList.contains('on'));
    check('selecting boy highlights it', selected);

    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(800);
    const onApp = await page.$('.tabbar');
    check('onboarding completes once a sex is chosen', !!onApp);

    const savedSex = await page.evaluate(() => JSON.parse(localStorage.getItem('hearth.state.v1')).baby.sex);
    check('the chosen sex persists to state', savedSex === 'boy', savedSex);

    // Regression: stale _onbSex/_onbPhoto must not survive a full reset+reload.
    // After onboarding, the server-side family exists so init() renders
    // provisionedView(), not onboarding(). Test the fix directly: reload with
    // a fresh localStorage, then call onboarding() from the module to confirm
    // module-level state was reset.
    await page.evaluate(() => localStorage.clear());
    await page.goto(srv.base + '/');
    await page.waitForSelector('.onboard', { timeout: 10000 });
    // Force onboarding() to render regardless of server state.
    const html = await page.evaluate(async () => {
      const mod = await import('/js/onboarding.js');
      return mod.onboarding();
    });
    const hasSelectedSex = html.includes('class="sex-opt on"');
    check('onboarding() HTML has no pre-selected sex after re-render', !hasSelectedSex);

    // Fill name but skip sex, click finish — must stay on onboarding.
    await page.evaluate(async () => {
      const mod = await import('/js/onboarding.js');
      document.querySelector('#app').innerHTML = mod.onboarding();
    });
    await page.fill('#onb-name', 'Second Baby');
    await page.click('[data-action="onboard:finish"]');
    await page.waitForTimeout(300);
    const stillOnboardingAfterReset = await page.$('#onb-name');
    check('onboarding after a reset still requires a sex choice', !!stillOnboardingAfterReset);
  } catch (e) {
    check('onboarding sex test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
