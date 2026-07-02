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
      st.caregivers = [
        { id: 'cg1', displayName: 'Maya', role: 'Parent', photo: '' },
        { id: 'cg2', displayName: 'Sam', role: 'Parent', photo: 'https://example.com/sam.jpg' },
      ];
      st.log.unshift({ id: 'author-test', type: 'bottle', start: new Date().toISOString(), amount: 120, caregiverId: 'cg1' });
      st.log.unshift({ id: 'author-test-photo', type: 'bottle', start: new Date().toISOString(), amount: 90, caregiverId: 'cg2' });
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();

    await page.click('[data-id="author-test"]');
    await page.waitForSelector('.entry-author');
    const author = await page.$eval('.entry-author-name', (el) => el.textContent.trim());
    check('entry detail shows author', author === 'Logged by Maya', author);
    const initialAvatar = await page.$eval('.entry-author-avatar', (el) => el.textContent.trim());
    check('author avatar shows initial when no photo', initialAvatar === 'M', initialAvatar);

    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);
    await page.click('[data-id="author-test-photo"]');
    await page.waitForSelector('.entry-author');
    const photoAuthor = await page.$eval('.entry-author-name', (el) => el.textContent.trim());
    check('entry detail shows second author', photoAuthor === 'Logged by Sam', photoAuthor);
    const avatarBg = await page.$eval('.entry-author-avatar', (el) => el.style.backgroundImage);
    check('author avatar shows photo background when photo present', avatarBg.includes('example.com/sam.jpg'), avatarBg);
  } catch (e) {
    check('entry author test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });