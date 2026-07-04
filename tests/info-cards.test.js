const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 820 });
    // Pre-seed localStorage before the app ever boots, instead of onboarding
    // through the UI and overwriting afterward. Onboarding kicks off async
    // family-creation/outbox work; overwriting state from outside afterward
    // raced the page's own in-flight save() calls, which could clobber the
    // overwrite depending on timing. Seeding pre-boot means the app's very
    // first read of state already has what we want, and since setup is
    // already true, onboarding never runs at all.
    await page.addInitScript(() => {
      const now = new Date();
      const birth = new Date(now);
      birth.setDate(birth.getDate() - 154);
      const log = [];
      for (let i = 0; i < 14; i += 1) {
        const day = new Date(now);
        day.setDate(day.getDate() - i);
        const start = new Date(day);
        start.setHours(0, 30, 0, 0);
        const end = new Date(day);
        end.setHours(7, 5, 0, 0);
        log.push({ id: `night-${i}`, type: 'sleep', start: start.toISOString(), end: end.toISOString() });
      }
      localStorage.setItem('hearth.state.v1', JSON.stringify({
        setup: true,
        synced: false,
        baby: { name: 'Mina', birthdate: birth.toISOString().slice(0, 10), theme: 'girl', photo: null, caregiver: 'Maya' },
        settings: {
          theme: '', bottleIntervalH: 3,
          meds: [{ id: 'm1', name: 'Vitamin D', dose: '1', unit: 'drop', everyH: 24 }],
          playTypes: ['Tummy time', 'Reading', 'Outdoor'],
          units: { volume: 'ml', temp: 'C', weight: 'kg', length: 'cm' },
          reminders: { naps: true, bottle: true, meds: true, lead: 0, quietStart: '20:00', quietEnd: '07:00' },
          cards: { bottle: true, medicine: true, order: ['bottle', 'medicine'], intervals: {} },
          sound: true, clock24: '12h', darkMode: 'auto', seenChangelog: '',
          tipMorningLightDismissed: false, dismissedTips: [], dismissedRegressions: []
        },
        log,
        growth: [], caregivers: [], currentCaregiverId: ''
      }));
    });
    await page.goto(srv.base + '/');
    await page.waitForSelector('.tip-card');

    const sourceLines = await page.$$eval('.tip-source', (els) => els.map((el) => el.textContent.trim()));
    check('info cards render secondary source lines', sourceLines.length >= 2, sourceLines.join(' | '));
    check('morning light card cites circadian research', sourceLines.some((line) => line.includes('Yates 2018') && line.includes('Kok 2024')), sourceLines.join(' | '));

    const headings = await page.$$eval('.tip-card', (cards) => cards.map((card) => ({
      title: card.querySelector('.tip-hd')?.textContent.trim() || '',
      text: card.textContent.trim(),
    })));
    check('info cards render a title', headings.every((h) => h.title), JSON.stringify(headings));
    check('info card titles do not start with info prefix', headings.every((h) => !/^info\s+/i.test(h.title)), JSON.stringify(headings));

    const morning = headings.find((h) => h.title.includes('Morning light'));
    check('morning light title renders without icon category prefix', morning && !/^info\s+/i.test(morning.title), JSON.stringify(headings));
    check('morning light copy includes observed wake time', morning && /7:0?5/.test(morning.text), morning ? morning.text : JSON.stringify(headings));
    check('stage tip cites research', sourceLines.some((line) => /Source:/.test(line) && !line.includes('Yates 2018; Kok 2024')), sourceLines.join(' | '));
  } catch (e) {
    check('info cards test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
