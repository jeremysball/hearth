const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18806);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // A fresh sleep form's details start collapsed and unselected.
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('.sleep-details');
    const startsClosed = await page.$eval('.sleep-details', (el) => !el.open);
    check('sleep details section starts collapsed', startsClosed);

    // Expand and pick one option in each new field.
    await page.click('.sleep-details summary');
    await page.click('[data-seg="startMood"] [data-val="Content"]');
    await page.click('[data-seg="fallAsleep"] [data-val="Under 10 min"]');
    await page.click('[data-icongrid="method"] [data-val="Nursing"]');
    await page.click('[data-seg="endMood"] [data-val="Content"]');
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);

    const saved = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'sleep');
      return e ? { startMood: e.startMood, fallAsleep: e.fallAsleep, method: e.method, endMood: e.endMood } : null;
    });
    check('sleep entry saves startMood: Content', saved && saved.startMood === 'Content', saved);
    check('sleep entry saves fallAsleep: Under 10 min', saved && saved.fallAsleep === 'Under 10 min', saved);
    check('sleep entry saves method: Nursing', saved && saved.method === 'Nursing', saved);
    check('sleep entry saves endMood: Content', saved && saved.endMood === 'Content', saved);

    // Reopen for edit: all four selections must be restored.
    const entryId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'sleep').id;
    });
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('.sleep-details');
    const startMoodOn = await page.$eval('[data-seg="startMood"] [data-val="Content"]', (el) => el.classList.contains('on'));
    const methodOn = await page.$eval('[data-icongrid="method"] [data-val="Nursing"]', (el) => el.classList.contains('on'));
    const detailsOpen = await page.$eval('.sleep-details', (el) => el.open);
    check('editing a sleep entry restores startMood selection', startMoodOn);
    check('editing a sleep entry restores method selection', methodOn);
    check('editing a sleep entry with saved details auto-expands the details section', detailsOpen);

    // A sleep entry with no details set at all must save cleanly (fields stay null).
    const beforeCount = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.filter((x) => x.type === 'sleep').length;
    });
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(300);
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('.sleep-details');
    await page.waitForTimeout(300);
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);
    const afterCount = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.filter((x) => x.type === 'sleep').length;
    });
    check('a sleep entry with no optional details saves without throwing', afterCount === beforeCount + 1, { beforeCount, afterCount });
  } catch (e) {
    check('sleep details test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
