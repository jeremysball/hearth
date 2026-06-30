const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18795);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await page.waitForSelector('.theme-opt');

    const themes = await page.$$eval('.theme-opt', (els) => els.map((el) => el.dataset.theme));
    check('onboarding shows four theme choices', themes.join(',') === 'girl,boy,dayjob-girl,dayjob-boy', themes.join(','));

    for (const theme of themes) {
      await page.click(`.theme-opt[data-theme="${theme}"]`);
      const bodyTheme = await page.evaluate(() => document.body.dataset.theme);
      const selected = await page.$eval(`.theme-opt[data-theme="${theme}"]`, (el) => el.classList.contains('on'));
      check('theme preview updates for ' + theme, bodyTheme === theme, bodyTheme);
      check('selected state updates for ' + theme, selected);
    }

    const tagline = await page.$eval('.onb-tagline', (el) => ({
      text: el.textContent.trim(),
      family: getComputedStyle(el).fontFamily,
      fontStyle: getComputedStyle(el).fontStyle,
    }));
    check('tagline copy is concise', tagline.text === "A calm home for your baby's days. Let's set things up.", tagline.text);
    check('tagline uses Playfair Display', tagline.family.includes('Playfair Display'), tagline.family);
    check('tagline is italic', tagline.fontStyle === 'italic', tagline.fontStyle);
  } catch (e) {
    check('onboarding theme test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
