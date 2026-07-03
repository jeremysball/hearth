const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

// Seeds baby + sleep log relative to the page's (faked) clock, then reloads.
async function seed(page, { minutesAwake = null, asleep = false, birthDaysAgo = 245, birthdate = null }) {
  await page.evaluate(({ minutesAwake, asleep, birthDaysAgo, birthdate }) => {
    const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
    const now = new Date();
    if (birthdate) { st.baby.birthdate = birthdate; }
    else {
      const birth = new Date(now); birth.setDate(birth.getDate() - birthDaysAgo);
      st.baby.birthdate = birth.toISOString().slice(0, 10);
    }
    st.log = [];
    if (asleep) {
      const start = new Date(now.getTime() - 30 * 60000);
      st.log.push({ id: 's1', type: 'sleep', start: start.toISOString() });
    } else if (minutesAwake != null) {
      const end = new Date(now.getTime() - minutesAwake * 60000);
      const start = new Date(end.getTime() - 70 * 60000);
      st.log.push({ id: 's1', type: 'sleep', start: start.toISOString(), end: end.toISOString() });
    }
    localStorage.setItem('hearth.state.v1', JSON.stringify(st));
  }, { minutesAwake, asleep, birthDaysAgo, birthdate });
  await page.reload();
  await page.waitForSelector('.card.hero .sky');
}

const skyMode = (page) => page.getAttribute('.card.hero .sky', 'data-sky');
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };

(async () => {
  const srv = await startServer(18811);
  const browser = await launchBrowser();
  try {
    // ---- daytime states (clock pinned to 13:00: wakePosition = middle,
    // 8-month-old population window = [140, 170]) ----
    const page = await browser.newPage();
    await page.setViewportSize({ width: 360, height: 820 });
    await page.clock.install({ time: at(13) });
    await page.goto(srv.base + '/');
    await onboard(page);

    await seed(page, { minutesAwake: 20 });
    check('early window renders morning sky', await skyMode(page) === 'morning', await skyMode(page));
    check('morning sky shows the sun', Boolean(await page.$('.sky-sun')));
    check('sun has a rotating ray field', Boolean(await page.$('.sun-rays')));
    check('no ridge landscape or house (Ember Horizon: light only)', !(await page.$('.sky-ridge-far')) && !(await page.$('.sky-house')));
    check('awake hero shows the ember-glow field, not the coal bed', Boolean(await page.$('.ember-glow')) && !(await page.$('.sh-bed')));

    await seed(page, { minutesAwake: 100 });
    check('mid window renders day sky', await skyMode(page) === 'day', await skyMode(page));
    check('day sky drifts clouds', Boolean(await page.$('.sky-cloud')));

    await seed(page, { minutesAwake: 130 });
    check('sweetspot renders golden hour', await skyMode(page) === 'golden', await skyMode(page));

    await seed(page, { minutesAwake: 180 });
    check('past window renders twilight', await skyMode(page) === 'twilight', await skyMode(page));
    check('twilight shows first stars', Boolean(await page.$('.sky-stars-rich')));
    const cardAnim = await page.$eval('.card.hero', (el) => getComputedStyle(el).animationName);
    check('twilight card is not pulsing red', !cardAnim.includes('overtired-pulse'), cardAnim);

    await seed(page, { asleep: true, birthdate: '2026-01-01' });
    check('asleep renders night sky', await skyMode(page) === 'night', await skyMode(page));
    check('night sky shows a real-phase moon', Boolean(await page.$('.sky-moon')));
    check('capricorn constellation traced at night', Boolean(await page.$('.sky-constellation')));
    const moonBox = await page.$eval('.sky-moon', (el) => el.getBoundingClientRect());
    const constBox = await page.$eval('.sky-constellation', (el) => el.getBoundingClientRect());
    const overlaps = moonBox.left < constBox.right && moonBox.right > constBox.left &&
      moonBox.top < constBox.bottom && moonBox.bottom > constBox.top;
    check('moon and constellation do not overlap', !overlaps, JSON.stringify({ moonBox, constBox }));

    const timerColor = await page.$eval('.hero-fg .timer', (el) => getComputedStyle(el).color);
    // Chromium may serialize computed color as rgb(...) or oklch(...) depending on version.
    let isLight;
    const oklchMatch = timerColor.match(/^oklch\(([\d.]+)/);
    if (oklchMatch) {
      isLight = Number(oklchMatch[1]) > 0.6; // oklch lightness is 0..1
    } else {
      const [r, g, b] = (timerColor.match(/\d+/g) || []).map(Number);
      isLight = (r + g + b) / 3 > 150;
    }
    check('night timer text is light for contrast', isLight, timerColor);
    await page.close();

    // ---- circadian deep night (3am) ----
    const nightPage = await browser.newPage();
    await nightPage.setViewportSize({ width: 360, height: 820 });
    await nightPage.clock.install({ time: at(3) });
    await nightPage.goto(srv.base + '/');
    await onboard(nightPage);
    await seed(nightPage, { minutesAwake: 30 });
    check('12-6am renders deep night', await skyMode(nightPage) === 'deep-night', await skyMode(nightPage));
    check('deep night drops clouds', !(await nightPage.$('.sky-cloud')));
    await nightPage.close();

    // ---- reduced motion: fully static scene ----
    const rmCtx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 360, height: 820 } });
    const rmPage = await rmCtx.newPage();
    await rmPage.clock.install({ time: at(13) });
    await rmPage.goto(srv.base + '/');
    await onboard(rmPage);
    await seed(rmPage, { minutesAwake: 100 });
    check('reduced motion still renders the scene', Boolean(await rmPage.$('.card.hero .sky')));
    const anim = await rmPage.$eval('.sky-cloud', (el) => getComputedStyle(el).animationName);
    check('reduced motion stops cloud drift', anim === 'none', anim);
    await rmCtx.close();
  } catch (e) {
    check('sky scene suite ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
