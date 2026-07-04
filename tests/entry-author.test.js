const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18797);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Pre-seed localStorage before the app ever boots, instead of onboarding
    // through the UI and overwriting afterward. Onboarding kicks off async
    // family-creation/outbox work; overwriting state from outside afterward
    // raced the page's own in-flight save() calls, which could clobber the
    // overwrite depending on timing. Seeding pre-boot means the app's very
    // first read of state already has what we want, and since setup is
    // already true, onboarding never runs at all.
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
          { id: 'author-test-photo', type: 'bottle', start: now, amount: 90, caregiverId: 'cg2' },
          { id: 'author-test', type: 'bottle', start: now, amount: 120, caregiverId: 'cg1' },
        ],
        growth: [],
        caregivers: [
          { id: 'cg1', displayName: 'Maya', role: 'Parent', photo: '' },
          { id: 'cg2', displayName: 'Sam', role: 'Parent', photo: 'https://example.com/sam.jpg' },
        ],
        currentCaregiverId: ''
      }));
    });
    await page.goto(srv.base + '/');

    await page.click('[data-id="author-test"]');
    await page.waitForSelector('.entry-author');
    const author = await page.$eval('.entry-author-name', (el) => el.textContent.trim());
    check('entry detail shows author', author === 'Logged by Maya', author);
    const initialAvatar = await page.$eval('.entry-author-avatar', (el) => el.textContent.trim());
    check('author avatar shows initial when no photo', initialAvatar === 'M', initialAvatar);

    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);
    await page.click('[data-id="author-test-photo"]');
    await page.waitForSelector('.entry-author');
    const photoAuthor = await page.$eval('.entry-author-name', (el) => el.textContent.trim());
    check('entry detail shows second author', photoAuthor === 'Logged by Sam', photoAuthor);
    const avatarBg = await page.$eval('.entry-author-avatar', (el) => el.style.backgroundImage);
    check('author avatar shows photo background when photo present', avatarBg.includes('example.com/sam.jpg'), avatarBg);
  } catch (e) {
    check('entry author test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });