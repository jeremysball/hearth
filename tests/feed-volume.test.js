const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18800);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('hearth.state.v1');
      const st = JSON.parse(raw);
      const now = new Date().toISOString();
      st.log = [
        { id: 'bottle-vol', type: 'bottle', start: now, amount: 120 },
        { id: 'pump-vol', type: 'pump', start: now, amount: 90 },
      ];
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await page.click('.tab[data-tab="trends"]');
    await page.waitForSelector('.chart-card');
    const body = await page.textContent('#view');
    const avgFeedVol = await page.locator('.stat', { hasText: 'Avg feed vol / day' }).textContent();
    check('trends shows feed volume stat', body.includes('Avg feed vol / day'), body);
    check('feed volume average uses 7-day mean', avgFeedVol.includes('30ml') || avgFeedVol.includes('30 ml'), avgFeedVol);
    check('trends shows feed volume chart', body.includes('Feed volume'), body);
    check('feed volume includes bottle and pump', body.includes('210ml') || body.includes('210 ml'), body);
  } catch (e) {
    check('feed volume test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
