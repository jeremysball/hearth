const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18803);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Open the play log form: it should offer a type selector seeded with defaults.
    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-seg="playType"]');
    const defaultTypes = await page.$$eval('[data-seg="playType"] .seg-opt', (els) => els.map((el) => el.dataset.val));
    check('play form offers default play types', defaultTypes.length > 0, defaultTypes.join(','));

    // Pick a non-default-selected type and save.
    const target = defaultTypes[defaultTypes.length - 1];
    await page.click(`[data-seg="playType"] .seg-opt[data-val="${target}"]`);
    await page.click('[data-action="log:save"][data-type="play"]');
    await page.waitForTimeout(300);

    const savedType = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'play');
      return e ? e.playType : undefined;
    });
    check('play entry saves the selected type', savedType === target, savedType);

    // Manage play types: add one, remove one, save.
    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-action="playtypes:open"]');
    await page.click('[data-action="playtypes:open"]');
    await page.waitForSelector('#playtype-list');
    check('manage play types sheet opens', true);

    await page.click('[data-action="playtype:add"]');
    await page.fill('#playtype-list .playtype-row:last-child .playtype-name', 'Sensory bin');
    const firstRemove = await page.$('#playtype-list .playtype-row [data-action="playtype:remove"]');
    await firstRemove.click();
    await page.click('[data-action="playtypes:save"]');
    await page.waitForTimeout(300);

    const updatedTypes = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.settings.playTypes;
    });
    check('saving play types persists additions', updatedTypes.includes('Sensory bin'), JSON.stringify(updatedTypes));
    check('saving play types persists removals', !updatedTypes.includes(defaultTypes[0]), JSON.stringify(updatedTypes));

    // Reopen the play form: the seg options should reflect the updated list.
    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-seg="playType"]');
    const refreshedTypes = await page.$$eval('[data-seg="playType"] .seg-opt', (els) => els.map((el) => el.dataset.val));
    check('play form reflects updated type list', refreshedTypes.includes('Sensory bin') && !refreshedTypes.includes(defaultTypes[0]), refreshedTypes.join(','));
  } catch (e) {
    check('play types test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
