const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18802);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Log a diaper entry with the rash toggle on.
    await page.click('[data-action="log:open"][data-type="diaper"]');
    await page.waitForSelector('#f-rash');
    await page.click('#f-rash');
    await page.click('[data-action="log:save"][data-type="diaper"]');
    await page.waitForTimeout(300);

    const savedRash = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'diaper');
      return e ? e.rash : undefined;
    });
    check('diaper entry saves rash: true when toggled on', savedRash === true, savedRash);

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
  } catch (e) {
    check('diaper rash test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
