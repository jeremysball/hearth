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
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Saving play types must enqueue playTypes in the /api/settings sync body,
    // not just persist locally — the sync layer has to carry it too.
    const lastSettingsOp = await page.evaluate(() => {
      const outbox = JSON.parse(localStorage.getItem('hearth.outbox.v1') || '[]');
      const ops = outbox.filter((op) => op.url === '/api/settings');
      return ops[ops.length - 1];
    });
    check('saving play types enqueues a /api/settings sync op', !!lastSettingsOp, JSON.stringify(lastSettingsOp));
    check('the /api/settings sync body includes playTypes', lastSettingsOp && Array.isArray(lastSettingsOp.body.playTypes) && lastSettingsOp.body.playTypes.includes('Sensory bin'), JSON.stringify(lastSettingsOp && lastSettingsOp.body));

    // Edit path: reopening a saved play entry must reselect its saved type.
    const playEntryId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'play').id;
    });
    await page.click(`[data-id="${playEntryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('[data-seg="playType"]');
    const reselected = await page.$eval('[data-seg="playType"] .seg-opt.on', (el) => el.dataset.val).catch(() => null);
    check('editing a play entry reselects its saved type', reselected === target, reselected);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Orphaned type: remove the type this entry uses from settings, then edit
    // the entry. The form must not crash, and no option should read as selected.
    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-action="playtypes:open"]');
    await page.click('[data-action="playtypes:open"]');
    await page.waitForSelector('#playtype-list');
    const targetRemove = await page.$(`#playtype-list .playtype-row:has(input[value="${target}"]) [data-action="playtype:remove"]`);
    if (targetRemove) await targetRemove.click();
    await page.click('[data-action="playtypes:save"]');
    await page.waitForTimeout(300);

    await page.click(`[data-id="${playEntryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('[data-seg="playType"]');
    const orphanedSelection = await page.$('[data-seg="playType"] .seg-opt.on');
    check('editing an entry whose type was removed shows no option selected', orphanedSelection === null);

    await page.click('[data-action="log:save"][data-type="play"]');
    await page.waitForTimeout(300);
    const finalPlayType = await page.evaluate((id) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.id === id);
      return e ? e.playType : undefined;
    }, playEntryId);
    check('saving without reselecting an orphaned type clears playType to null', finalPlayType === null, finalPlayType);

    // Empty playTypes: clearing every type must not crash the form, and it
    // should fall back to no type selector at all.
    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-action="playtypes:open"]');
    await page.click('[data-action="playtypes:open"]');
    await page.waitForSelector('#playtype-list');
    let removeBtn = await page.$('#playtype-list .playtype-row [data-action="playtype:remove"]');
    while (removeBtn) {
      await removeBtn.click();
      removeBtn = await page.$('#playtype-list .playtype-row [data-action="playtype:remove"]');
    }
    await page.click('[data-action="playtypes:save"]');
    await page.waitForTimeout(300);

    await page.click('[data-action="log:open"][data-type="play"]');
    await page.waitForSelector('[data-action="log:save"][data-type="play"]');
    const noSegRendered = await page.$('[data-seg="playType"]');
    check('an empty play-types list renders the form without a type selector', noSegRendered === null);
    await page.click('[data-action="log:save"][data-type="play"]');
    await page.waitForTimeout(300);
    const savedWithoutType = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const entries = st.log.filter((x) => x.type === 'play');
      return entries[entries.length - 1].playType;
    });
    check('logging play with no types configured saves playType: null', savedWithoutType === null, savedWithoutType);
  } catch (e) {
    check('play types test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
