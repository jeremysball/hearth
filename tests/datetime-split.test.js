const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18805);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Local (not UTC) YYYY-MM-DD, matching what date inputs and the home
    // "today" filter both use.
    const localDateStr = (offsetDays) => page.evaluate((n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }, offsetDays);
    const today = await localDateStr(0);
    const tomorrow = await localDateStr(1);

    // A representative timeRow() form (bottle) renders separate date + time inputs.
    await page.click('[data-action="log:open"][data-type="bottle"]');
    await page.waitForSelector('#f-time-date');
    const freshDate = await page.$eval('#f-time-date', (el) => el.value);
    const freshTime = await page.$eval('#f-time-time', (el) => el.value);
    check('a fresh bottle form has a full date value', /^\d{4}-\d{2}-\d{2}$/.test(freshDate), freshDate);
    check('a fresh bottle form has a full time value', /^\d{2}:\d{2}$/.test(freshTime), freshTime);

    // Setting an explicit date + time and saving recombines them into one ISO instant.
    await page.fill('#f-time-date', today);
    await page.fill('#f-time-time', '08:30');
    await page.click('[data-action="log:save"][data-type="bottle"]');
    await page.waitForTimeout(300);

    const expectedBottleISO = await page.evaluate((d) => new Date(`${d}T08:30`).toISOString(), today);
    const savedBottle = await page.evaluate((iso) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      // Match on the exact saved instant, not just type: onboarding seeds demo
      // bottle entries too, so type alone isn't unique.
      return st.log.find((e) => e.type === 'bottle' && e.start === iso);
    }, expectedBottleISO);
    check('saving a bottle entry recombines date + time into the correct ISO start', Boolean(savedBottle), JSON.stringify(savedBottle));

    // Reopening for edit splits the stored ISO back into the same date + time.
    await page.click(`[data-id="${savedBottle.id}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-time-date');
    const reopenedDate = await page.$eval('#f-time-date', (el) => el.value);
    const reopenedTime = await page.$eval('#f-time-time', (el) => el.value);
    check('editing a bottle entry prefills the date field', reopenedDate === today, reopenedDate);
    check('editing a bottle entry prefills the time field', reopenedTime === '08:30', reopenedTime);
    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    // Sleep form: separate fell-asleep / woke date + time pairs, including an
    // overnight span that crosses midnight.
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('#f-time-date');
    await page.fill('#f-time-date', today);
    await page.fill('#f-time-time', '21:00');
    await page.fill('#f-end-date', tomorrow);
    await page.fill('#f-end-time', '06:15');
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);

    const expectedSleepStartISO = await page.evaluate((d) => new Date(`${d}T21:00`).toISOString(), today);
    const expectedSleepEndISO = await page.evaluate((d) => new Date(`${d}T06:15`).toISOString(), tomorrow);
    const savedSleep = await page.evaluate((iso) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      // Match on the exact saved instant: onboarding seeds demo sleep entries too.
      return st.log.find((e) => e.type === 'sleep' && e.start === iso);
    }, expectedSleepStartISO);
    check('an overnight sleep entry saves the correct start instant', Boolean(savedSleep), JSON.stringify(savedSleep));
    check('an overnight sleep entry saves the correct end instant on the next day', savedSleep && savedSleep.end === expectedSleepEndISO, JSON.stringify(savedSleep));

    // Editing that sleep entry splits both start and end back into their pairs.
    await page.click(`[data-id="${savedSleep.id}"]`);
    await page.waitForSelector('[data-action="entry:edit"]');
    await page.click('[data-action="entry:edit"]');
    await page.waitForSelector('#f-end-date');
    const editStartDate = await page.$eval('#f-time-date', (el) => el.value);
    const editEndDate = await page.$eval('#f-end-date', (el) => el.value);
    const editEndTime = await page.$eval('#f-end-time', (el) => el.value);
    check('editing an overnight sleep entry prefills the fell-asleep date', editStartDate === today, editStartDate);
    check('editing an overnight sleep entry prefills the woke date on the next day', editEndDate === tomorrow, editEndDate);
    check('editing an overnight sleep entry prefills the woke time', editEndTime === '06:15', editEndTime);

    // Clearing both Woke fields and saving reopens the sleep entry (regression
    // guard for the earlier "sleep empty-time bug" fix, now with paired inputs).
    await page.fill('#f-end-date', '');
    await page.fill('#f-end-time', '');
    await page.click('[data-action="log:save"][data-type="sleep"]');
    await page.waitForTimeout(300);
    const reopenedSleep = await page.evaluate((iso) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((e) => e.type === 'sleep' && e.start === iso);
    }, expectedSleepStartISO);
    check('clearing both Woke fields and saving leaves the sleep entry open (end: null)', reopenedSleep && reopenedSleep.end === null, JSON.stringify(reopenedSleep));
  } catch (e) {
    check('datetime split test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
