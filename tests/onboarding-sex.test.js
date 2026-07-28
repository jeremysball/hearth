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
  } catch (e) {
    check('onboarding sex test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
