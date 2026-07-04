const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18801);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Pre-seed localStorage before the app ever boots, instead of onboarding
    // through the UI and overwriting the log afterward. Onboarding kicks off
    // async family-creation/outbox work; overwriting the log from outside
    // afterward raced the page's own in-flight save() calls, which could
    // clobber our overwrite with the pre-onboarding log depending on timing.
    // Seeding pre-boot means the app's very first read of state already has
    // the entry we want, and since setup is already true, onboarding never
    // runs at all.
    await page.addInitScript(() => {
      const now = Date.now();
      localStorage.setItem('hearth.state.v1', JSON.stringify({
        setup: true,
        synced: false,
        baby: { name: 'Test', birthdate: '2025-01-01', theme: 'girl', photo: null, caregiver: 'Maya' },
        settings: {
          theme: '', bottleIntervalH: 3,
          meds: [{ id: 'm1', name: 'Vitamin D', dose: '1', unit: 'drop', everyH: 24 }],
          playTypes: ['Tummy time', 'Reading', 'Outdoor'],
          units: { volume: 'ml', temp: 'C', weight: 'kg', length: 'cm' },
          reminders: { naps: true, bottle: true, meds: true, lead: 0, quietStart: '20:00', quietEnd: '07:00' },
          cards: { bottle: true, medicine: true, order: ['bottle', 'medicine'], intervals: {} },
          sound: true, clock24: '12h', darkMode: 'auto', seenChangelog: ''
        },
        log: [
          {
            id: 'sleep-test',
            type: 'sleep',
            start: new Date(now - 2 * 3600000).toISOString(),
            end: new Date(now - 3600000).toISOString(),
          },
        ],
        growth: [], caregivers: [], currentCaregiverId: ''
      }));
    });
    await page.goto(srv.base + '/');

    await page.click('[data-id="sleep-test"]');
    await page.waitForSelector('[data-action="entry:edit"][data-id="sleep-test"]');
    await page.click('[data-action="entry:edit"][data-id="sleep-test"]');
    await page.waitForSelector('#f-end-date');
    await page.fill('#f-end-date', '');
    await page.fill('#f-end-time', '');
    await page.click('[data-action="log:save"]');
    await page.waitForTimeout(300);

    const entry = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((e) => e.id === 'sleep-test');
    });
    check('clearing Woke and saving reopens the sleep entry', !entry.end, JSON.stringify(entry));
  } catch (e) {
    check('sleep reopen test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
