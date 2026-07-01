const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18796);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.waitForSelector('.tab[data-tab="profile"] .tab-badge');
    check('profile tab shows changelog badge', true);

    await page.click('.tab[data-tab="profile"]');
    await page.waitForSelector('#changelog-card');
    const title = await page.$eval('#changelog-card h2', (el) => el.textContent.trim());
    check('profile renders changelog card', title === 'Changelog', title);

    await page.waitForFunction(() => {
      const view = document.querySelector('#view');
      const card = document.querySelector('#changelog-card');
      if (!view || !card) return false;
      const viewRect = view.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return cardRect.top >= viewRect.top && cardRect.top < viewRect.bottom;
    });
    check('profile scrolls to changelog', true);

    await page.waitForFunction(() => !document.querySelector('.tab[data-tab="profile"] .tab-badge'));
    check('opening profile clears changelog badge', true);
  } catch (e) {
    check('changelog test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
