const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18797);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('hearth.state.v1');
      const st = JSON.parse(raw);
      st.caregivers = [{ id: 'cg1', displayName: 'Maya', role: 'Parent', photo: '' }];
      st.log.unshift({ id: 'author-test', type: 'bottle', start: new Date().toISOString(), amount: 120, caregiverId: 'cg1' });
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await page.click('[data-id="author-test"]');
    await page.waitForSelector('.entry-author');
    const author = await page.$eval('.entry-author', (el) => el.textContent.trim());
    check('entry detail shows author', author === 'Logged by Maya', author);
  } catch (e) {
    check('entry author test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });