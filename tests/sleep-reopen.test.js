const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18801);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('hearth.state.v1');
      const st = JSON.parse(raw);
      const now = Date.now();
      st.log.unshift({
        id: 'sleep-test',
        type: 'sleep',
        start: new Date(now - 2 * 3600000).toISOString(),
        end: new Date(now - 3600000).toISOString(),
      });
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();

    await page.click('[data-id="sleep-test"]');
    await page.waitForSelector('[data-action="entry:edit"][data-id="sleep-test"]');
    await page.click('[data-action="entry:edit"][data-id="sleep-test"]');
    await page.waitForSelector('#f-end');
    await page.fill('#f-end', '');
    await page.click('[data-action="log:save"]');
    await page.waitForTimeout(300);

    const entry = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((e) => e.id === 'sleep-test');
    });
    check('clearing Woke and saving reopens the sleep entry', !entry.end, JSON.stringify(entry));
  } catch (e) {
    check('sleep reopen test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
