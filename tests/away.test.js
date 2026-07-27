const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18813);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // "away" isn't a pinned Home quick-action (like pump/note, it's occasional),
    // so it's reached through the "More" chooser rather than a direct button.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('.chooser');
    const chooserOffersAway = await page.$('.chooser [data-action="log:open"][data-type="away"]');
    check('the "More" type chooser offers Away', chooserOffersAway !== null);

    // Log a live away block (leave "back" blank).
    await page.click('.chooser [data-action="log:open"][data-type="away"]');
    await page.waitForSelector('[data-action="log:save"][data-type="away"]');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);

    const savedLive = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'away');
      return e ? { end: e.end, hasStart: !!e.start } : null;
    });
    check('a live away entry saves with no end', savedLive && savedLive.end == null && savedLive.hasStart, JSON.stringify(savedLive));

    // Row rendering shows "Away" / "since HH:MM" while ongoing.
    const rowText = await page.evaluate(() => document.querySelector('[data-id]')?.textContent || '');
    check('the ongoing away row reads "Away"', rowText.includes('Away'), rowText);

    // Edit the entry to set an end time, closing the block.
    const awayId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'away').id;
    });
    await page.click(`[data-id="${awayId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-end-date');
    await page.fill('#f-end-date', '2026-01-02');
    await page.fill('#f-end-time', '09:00');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);

    const closed = await page.evaluate((id) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.id === id).end;
    }, awayId);
    check('editing an away entry to add an end time saves it', !!closed, closed);

    // Re-opening for edit reselects the saved end date/time.
    await page.click(`[data-id="${awayId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-end-date');
    const reselectedDate = await page.$eval('#f-end-date', (el) => el.value);
    check('editing a closed away entry reselects its saved end date', reselectedDate === '2026-01-02', reselectedDate);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Start a fresh, still-ongoing away block and check the hero reflects it.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('.chooser');
    await page.click('.chooser [data-action="log:open"][data-type="away"]');
    await page.waitForSelector('[data-action="log:save"][data-type="away"]');
    await page.click('[data-action="log:save"][data-type="away"]');
    await page.waitForTimeout(300);
    const heroText = await page.evaluate(() => document.querySelector('.hero .state-lbl')?.textContent || '');
    check('the hero shows "Away since" while an away block is ongoing', heroText.includes('Away since'), heroText);
    const heroSubText = await page.evaluate(() => document.querySelector('.hero .hero-sub')?.textContent || '');
    check('the hero away state has no sweetspot rail', await page.$('.hero .sh-rail-wrap') === null, heroSubText);
  } catch (e) {
    check('away entry test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
