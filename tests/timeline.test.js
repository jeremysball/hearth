const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18794);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    // Pre-seed localStorage before the app ever boots, instead of onboarding
    // through the UI and injecting entries afterward. Onboarding's seed()
    // replaces the whole log, and any add-entry after it kicks off async
    // save()/sync work; overwriting the log from outside afterward raced
    // that in-flight work, which could clobber the overwrite depending on
    // timing. Seeding pre-boot means the app's very first read of state
    // already has the entries we want, and since setup is already true,
    // onboarding never runs at all.
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
          { id: 'diaper-test', type: 'diaper', start: now, kind: 'Wet' },
          { id: 'note-test', type: 'bottle', start: now, amount: 120, note: 'Fussy today' },
          { id: 'no-note-test', type: 'bottle', start: now, amount: 90 },
          { id: 'bath-note-test', type: 'bath', start: now, note: 'Loved the water' },
        ],
        growth: [], caregivers: [], currentCaregiverId: ''
      }));
    });
    await page.goto(srv.base + '/');
    await page.waitForSelector('.actions');

    const homeDotOnNoted = await page.$('[data-id="note-test"] .row-note-dot');
    check('home row shows a note dot when the entry has a note', Boolean(homeDotOnNoted));
    const homeDotOnUnnoted = await page.$('[data-id="no-note-test"] .row-note-dot');
    check('home row has no note dot when the entry has no note', !homeDotOnUnnoted);
    const homeDotOnBath = await page.$('[data-id="bath-note-test"] .row-note-dot');
    check('home row has no note dot for a bath entry (note already shown as meta)', !homeDotOnBath);

    // Open the timeline from Home.
    await page.click('[data-action="nav:timeline"]');
    await page.waitForSelector('.tl-chipbar');
    check('timeline opens with a chip bar', true);
    const rows = await page.$$('.tl-row');
    check('timeline shows at least one row', rows.length >= 1, 'rows=' + rows.length);
    const tlDotOnNoted = await page.$('[data-id="note-test"] .row-note-dot');
    check('timeline row shows a note dot when the entry has a note', Boolean(tlDotOnNoted));
    const tlDotOnUnnoted = await page.$('[data-id="no-note-test"] .row-note-dot');
    check('timeline row has no note dot when the entry has no note', !tlDotOnUnnoted);
    const tlDotOnBath = await page.$('[data-id="bath-note-test"] .row-note-dot');
    check('timeline row has no note dot for a bath entry (note already shown as meta)', !tlDotOnBath);
    const todayInfo = await page.$$eval('.tl-day-hd', els => {
      const hd = els.find(e => e.querySelector('span:first-child')?.textContent.trim() === 'Today');
      return hd ? { label: hd.querySelector('span:first-child').textContent.trim(), count: hd.querySelector('.tl-day-ct')?.textContent.trim() } : null;
    });
    check('timeline groups under a Today header', todayInfo && todayInfo.label === 'Today', JSON.stringify(todayInfo));
    check('timeline shows the Today entry count', todayInfo && Number(todayInfo.count) >= 1, JSON.stringify(todayInfo));

    const backIconExists = await page.$eval('.tl-back use', (use) => {
      const href = use.getAttribute('href');
      return Boolean(href && document.querySelector(href));
    });
    check('timeline back button icon resolves', backIconExists);

    const backUsesAccentTint = await page.$eval('.tl-back', (el) => {
      const st = getComputedStyle(el);
      const temp = document.createElement('div');
      temp.style.display = 'none';
      temp.style.backgroundColor = 'var(--accent-tint)';
      document.body.appendChild(temp);
      const computedAccent = getComputedStyle(temp).backgroundColor;
      document.body.removeChild(temp);
      return st.backgroundColor === computedAccent;
    });
    check('timeline back button uses accent tint', backUsesAccentTint, 'expected .tl-back background to match var(--accent-tint)');

    await page.waitForFunction(() => document.querySelector('.tl-chipbar')?.dataset.ready === 'true');
    const visibleFilters = await page.$$eval('.tl-chipbar .tl-chip:not([hidden])', (els) => els.map((el) => el.textContent.trim()));
    check('timeline keeps bottle sleep medicine visible', visibleFilters.slice(0, 3).join(',') === 'Bottle,Sleep,Medicine', visibleFilters.join(','));
    const hiddenFilters = await page.$$eval('.tl-chipbar .tl-chip[hidden][data-optional="true"]', (els) => els.map((el) => el.dataset.type));
    check('timeline hides overflow filters behind chevron', hiddenFilters.length > 0, hiddenFilters.join(','));
    const moreVisible = await page.$eval('.tl-more', (el) => !el.hidden);
    check('timeline overflow chevron appears', moreVisible);
    const chipbarDoesNotOverflow = await page.$eval('.tl-chipbar', (el) => el.scrollWidth <= el.clientWidth + 1);
    check('timeline chipbar does not drag horizontally', chipbarDoesNotOverflow);
    await page.click('.tl-more');
    await page.waitForSelector('.tl-filter-menu:not([hidden])');
    const menuFilters = await page.$$eval('.tl-filter-menu .tl-chip:not([hidden])', (els) => els.map((el) => el.dataset.type));
    check('timeline overflow menu exposes hidden filters', hiddenFilters.every((type) => menuFilters.includes(type)), JSON.stringify({ hiddenFilters, menuFilters }));
    // Filter to a type with no entries → filtered-empty state.
    await page.click('.tl-filter-menu .tl-chip[data-type="note"]');
    await page.waitForSelector('.tl-empty');
    check('filtering to an absent type shows the filtered-empty state', true);
    // Back returns to Home.
    await page.click('.tl-filter-menu .tl-chip[data-type="note"]'); // clear filter
    await page.waitForTimeout(300);
    await page.click('.tl-back');
    await page.waitForSelector('.actions');
    check('back returns to Home', true);
  } catch (e) {
    check('timeline test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
