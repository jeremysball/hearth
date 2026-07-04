const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18804);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // A fresh diaper form defaults to Wet and shows the single size selector.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.waitForSelector('[data-seg="kind"]');
    const singleVisibleAtStart = await page.$eval('#diaper-size-single', (el) => !el.hidden);
    const mixedHiddenAtStart = await page.$eval('#diaper-size-mixed', (el) => el.hidden);
    check('a fresh diaper form shows the single size selector', singleVisibleAtStart);
    check('a fresh diaper form hides the mixed size selectors', mixedHiddenAtStart);

    // Selecting Mixed swaps to the two size selectors.
    await page.click('[data-seg="kind"] .seg-opt[data-val="Mixed"]');
    const singleHiddenAfterMixed = await page.$eval('#diaper-size-single', (el) => el.hidden);
    const mixedVisibleAfterMixed = await page.$eval('#diaper-size-mixed', (el) => !el.hidden);
    check('selecting Mixed hides the single size selector', singleHiddenAfterMixed);
    check('selecting Mixed shows the wet/dirty size selectors', mixedVisibleAfterMixed);

    // The revealed wet/dirty seg-thumbs must have a real pill width, not the
    // 0px they'd get from being positioned while still hidden.
    const wetThumbWidth = await page.$eval('[data-seg="wetSize"] .seg-thumb', (el) => parseFloat(el.style.width) || 0);
    const dirtyThumbWidth = await page.$eval('[data-seg="dirtySize"] .seg-thumb', (el) => parseFloat(el.style.width) || 0);
    check('the wetSize thumb has a nonzero pill width when Mixed is revealed', wetThumbWidth > 0, wetThumbWidth);
    check('the dirtySize thumb has a nonzero pill width when Mixed is revealed', dirtyThumbWidth > 0, dirtyThumbWidth);

    // Pick distinct wet/dirty sizes and save.
    await page.click('[data-seg="wetSize"] .seg-opt[data-val="Small"]');
    await page.click('[data-seg="dirtySize"] .seg-opt[data-val="Large"]');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);

    const savedMixed = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? { kind: e.kind, size: e.size, wetSize: e.wetSize, dirtySize: e.dirtySize } : undefined;
    });
    check('a Mixed diaper entry saves wetSize and dirtySize', savedMixed && savedMixed.wetSize === 'Small' && savedMixed.dirtySize === 'Large', JSON.stringify(savedMixed));
    check('a Mixed diaper entry saves size: null, not a stale single value', savedMixed && savedMixed.size === null, JSON.stringify(savedMixed));

    const metaShowsSplitSize = await page.$eval('.row .meta', (el) => el.textContent.includes('Little/Large'));
    check('home card meta shows the wet/dirty size split for a Mixed entry', metaShowsSplitSize);

    // Reopen for edit: Mixed should show the split selectors, reselected.
    const entryId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'diaper').id;
    });
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('[data-seg="kind"]');
    const reopenedMixedVisible = await page.$eval('#diaper-size-mixed', (el) => !el.hidden);
    const reopenedSingleHidden = await page.$eval('#diaper-size-single', (el) => el.hidden);
    check('editing a Mixed entry shows the split size selectors', reopenedMixedVisible);
    check('editing a Mixed entry hides the single size selector', reopenedSingleHidden);
    const reselectedWet = await page.$eval('[data-seg="wetSize"] .seg-opt.on', (el) => el.dataset.val);
    const reselectedDirty = await page.$eval('[data-seg="dirtySize"] .seg-opt.on', (el) => el.dataset.val);
    check('editing a Mixed entry reselects wetSize', reselectedWet === 'Small', reselectedWet);
    check('editing a Mixed entry reselects dirtySize', reselectedDirty === 'Large', reselectedDirty);

    // Switch back to Wet and save: the single selector returns, and the
    // saved wet/dirty sizes must be explicitly cleared, not left stale.
    await page.click('[data-seg="kind"] .seg-opt[data-val="Wet"]');
    const singleVisibleAfterSwitch = await page.$eval('#diaper-size-single', (el) => !el.hidden);
    check('switching back to Wet shows the single size selector again', singleVisibleAfterSwitch);
    await page.click('[data-seg="size"] .seg-opt[data-val="Small"]');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);

    const savedWet = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? { kind: e.kind, size: e.size, wetSize: e.wetSize, dirtySize: e.dirtySize } : undefined;
    });
    check('switching a Mixed entry back to Wet saves the single size', savedWet && savedWet.size === 'Small', JSON.stringify(savedWet));
    check('switching a Mixed entry back to Wet clears wetSize/dirtySize', savedWet && savedWet.wetSize === null && savedWet.dirtySize === null, JSON.stringify(savedWet));

    // A plain Wet/Dirty entry (never Mixed) still uses the single selector on edit.
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('[data-seg="kind"]');
    const wetSingleVisible = await page.$eval('#diaper-size-single', (el) => !el.hidden);
    const wetMixedHidden = await page.$eval('#diaper-size-mixed', (el) => el.hidden);
    check('editing a Wet entry shows the single size selector', wetSingleVisible);
    check('editing a Wet entry hides the split size selectors', wetMixedHidden);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Dirty shares the single-selector branch with Wet — cover it directly
    // rather than relying on Wet coverage to stand in for it.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.waitForSelector('[data-seg="kind"]');
    await page.click('[data-seg="kind"] .seg-opt[data-val="Dirty"]');
    await page.click('[data-seg="size"] .seg-opt[data-val="Large"]');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    const savedDirty = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      // st.log is sorted newest-first, so the just-saved entry is at index 0.
      return st.log.find((x) => x.type === 'diaper' && x.kind === 'Dirty');
    });
    check('a Dirty diaper entry saves the single size', savedDirty.kind === 'Dirty' && savedDirty.size === 'Large', JSON.stringify(savedDirty));
    check('a Dirty diaper entry clears wetSize/dirtySize', savedDirty.wetSize === null && savedDirty.dirtySize === null, JSON.stringify(savedDirty));

    // Mixed entries combine with rash in the home card meta.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.waitForSelector('[data-seg="kind"]');
    await page.click('[data-seg="kind"] .seg-opt[data-val="Mixed"]');
    await page.click('[data-seg="wetSize"] .seg-opt[data-val="Small"]');
    await page.click('[data-seg="dirtySize"] .seg-opt[data-val="Large"]');
    await page.click('#f-rash');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    const rashMixedId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper' && x.kind === 'Mixed' && x.rash === true);
      return e ? e.id : null;
    });
    const rashMixedMeta = rashMixedId ? await page.$eval(`[data-id="${rashMixedId}"] .meta`, (el) => el.textContent) : '';
    check('a Mixed entry with rash shows both the size split and Rash in the meta', rashMixedMeta.includes('Little/Large') && rashMixedMeta.includes('Rash'), rashMixedMeta);

    // Legacy data: a Mixed entry logged before this feature only has `size`.
    // Loading it must not lose that size, and editing it must not silently
    // overwrite it with the Medium default.
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      st.log.unshift({ id: 'legacy-mixed', type: 'diaper', kind: 'Mixed', size: 'Large', start: new Date().toISOString() });
      localStorage.setItem('hearth.state.v1', JSON.stringify(st));
    });
    await page.reload();
    await page.waitForSelector('[data-id="legacy-mixed"]');
    const legacyMeta = await page.$eval('[data-id="legacy-mixed"] .meta', (el) => el.textContent);
    check('a legacy Mixed entry with only `size` still shows a size in its meta', legacyMeta.includes('Large'), legacyMeta);

    await page.click('[data-id="legacy-mixed"]');
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('[data-seg="wetSize"]');
    const legacyWet = await page.$eval('[data-seg="wetSize"] .seg-opt.on', (el) => el.dataset.val).catch(() => null);
    const legacyDirty = await page.$eval('[data-seg="dirtySize"] .seg-opt.on', (el) => el.dataset.val).catch(() => null);
    check('editing a legacy Mixed entry preselects its migrated wetSize, not the Medium default', legacyWet === 'Large', legacyWet);
    check('editing a legacy Mixed entry preselects its migrated dirtySize, not the Medium default', legacyDirty === 'Large', legacyDirty);
  } catch (e) {
    check('diaper mixed-size test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
