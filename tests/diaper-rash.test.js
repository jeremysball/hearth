const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18802);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // A fresh diaper form starts with the rash switch off.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.waitForSelector('#f-rash');
    const startsOff = await page.$eval('#f-rash', (el) => !el.classList.contains('on'));
    check('a fresh diaper form starts with the rash switch off', startsOff);

    // Log a diaper entry with the rash toggle on.
    await page.click('#f-rash');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);

    const savedRash = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? e.rash : undefined;
    });
    check('diaper entry saves rash: true when toggled on', savedRash === true, savedRash);

    const metaShowsRash = await page.$eval('.row .meta', (el) => el.textContent.includes('Rash'));
    check('home card meta shows Rash when the entry has rash', metaShowsRash);

    // Reopen for edit: the switch should reflect the saved state.
    const entryId = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.type === 'diaper').id;
    });
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-rash');
    const reopenedOn = await page.$eval('#f-rash', (el) => el.classList.contains('on'));
    check('editing a rash entry shows the switch on', reopenedOn);

    // Turn it back off and save — the patch must explicitly clear it, not just omit it.
    await page.click('#f-rash');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    const clearedRash = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? e.rash : undefined;
    });
    check('clearing the rash toggle and saving persists rash: false', clearedRash === false, clearedRash);

    // Clearing an entry's note on edit must persist, not just be omitted from the patch
    // (same Object.assign-never-deletes bug class the rash fix above addresses).
    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-note');
    await page.fill('#f-note', 'Looked a little irritated');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    const savedNote = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? e.note : undefined;
    });
    check('diaper entry saves a note', savedNote === 'Looked a little irritated', savedNote);

    await page.click(`[data-id="${entryId}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-note');
    await page.fill('#f-note', '');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);
    const clearedNote = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? e.note : undefined;
    });
    check('clearing the note field and saving persists an empty note', !clearedNote, clearedNote);
  } catch (e) {
    check('diaper rash test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
