const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18800);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Pre-seed localStorage before the app ever boots, instead of onboarding
    // through the UI and overwriting the log afterward. Onboarding's seed()
    // populates 6 days of demo data and kicks off an async family-creation
    // fetch; overwriting the log from outside afterward raced the page's own
    // in-flight save() calls, which could clobber our overwrite with the
    // stale seeded log depending on timing. Seeding pre-boot means the app's
    // very first read of state already has exactly the log we want, and
    // since setup is already true, onboarding (and its seed()/race) never
    // runs at all.
    await page.addInitScript(() => {
      const now = new Date().toISOString();
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
          { id: 'bottle-vol', type: 'bottle', start: now, amount: 120 },
          { id: 'pump-vol', type: 'pump', start: now, amount: 90 },
        ],
        growth: [], caregivers: [], currentCaregiverId: ''
      }));
    });
    await page.goto(srv.base + '/');
    await page.click('.tab[data-tab="trends"]');
    await page.waitForSelector('.chart-card');
    const body = await page.textContent('#view');
    const avgFeedVol = await page.locator('.stat', { hasText: 'Avg feed vol / day' }).textContent();
    check('trends shows feed volume stat', body.includes('Avg feed vol / day'), body);
    check('feed volume average uses 7-day mean', avgFeedVol.includes('30ml') || avgFeedVol.includes('30 ml'), avgFeedVol);
    check('trends shows feed volume chart', body.includes('Feed volume'), body);
    check('feed volume includes bottle and pump', body.includes('210ml') || body.includes('210 ml'), body);
  } catch (e) {
    check('feed volume test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
