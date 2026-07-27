const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

// Seeds baby + sleep log relative to the page's (faked) clock, then reloads.
async function seed(page, { minutesAwake = null, asleep = false, birthDaysAgo = 245, birthdate = null, awayStartAgo = null }) {
  await page.evaluate(({ minutesAwake, asleep, birthDaysAgo, birthdate, awayStartAgo }) => {
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
    if (awayStartAgo != null) {
      // Ongoing away block: started `awayStartAgo` minutes before now,
      // no end (still away).
      const awayStart = new Date(now.getTime() - awayStartAgo * 60000);
      st.log.push({ id: 'a1', type: 'away', start: awayStart.toISOString(), end: null });
    }
    localStorage.setItem('hearth.state.v1', JSON.stringify(st));
  }, { minutesAwake, asleep, birthDaysAgo, birthdate, awayStartAgo });
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
    // seed() below writes the sleep log and birthdate straight into
    // localStorage while the previous page is still live, then reloads. If
    // the background syncOnce() from that still-live page (fired on load, or
    // via the 15s interval) resolves in the gap before reload() navigates
    // away, its save() serializes the whole in-memory _state over what
    // seed() just wrote, clobbering the injected fixture with stale data —
    // a flaky race, worse the faster the reload happens. This test only
    // cares about client-rendered sky mode from the injected state, so
    // blocking the pull entirely removes the race without touching prod code.
    await page.route('**/api/sync*', (route) => route.abort());
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
    // Only one family may exist per server instance, so later pages/contexts
    // must inherit this page's onboarded storage state instead of onboarding
    // fresh — a second onboarding attempt against the same server now
    // correctly gets the "already provisioned" screen, not a new family.
    const storageState = await page.context().storageState();
    await page.close();

    // ---- circadian deep night (3am) ----
    const nightPage = await browser.newPage();
    await nightPage.context().addCookies(storageState.cookies);
    await nightPage.setViewportSize({ width: 360, height: 820 });
    await nightPage.route('**/api/sync*', (route) => route.abort());
    await nightPage.clock.install({ time: at(3) });
    await nightPage.goto(srv.base + '/');
    await nightPage.evaluate((origins) => {
      const o = origins.find((x) => x.origin === location.origin);
      if (o) for (const { name, value } of o.localStorage) localStorage.setItem(name, value);
    }, storageState.origins);
    await nightPage.reload();
    await onboard(nightPage);
    await seed(nightPage, { minutesAwake: 30 });
    check('12-6am renders deep night', await skyMode(nightPage) === 'deep-night', await skyMode(nightPage));
    check('deep night drops clouds', !(await nightPage.$('.sky-cloud')));
    await nightPage.close();

    // ---- reduced motion: fully static scene ----
    const rmCtx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 360, height: 820 }, storageState });
    const rmPage = await rmCtx.newPage();
    await rmPage.route('**/api/sync*', (route) => route.abort());
    await rmPage.clock.install({ time: at(13) });
    await rmPage.goto(srv.base + '/');
    await onboard(rmPage);
    await seed(rmPage, { minutesAwake: 100 });
    check('reduced motion still renders the scene', Boolean(await rmPage.$('.card.hero .sky')));
    const anim = await rmPage.$eval('.sky-cloud', (el) => getComputedStyle(el).animationName);
    check('reduced motion stops cloud drift', anim === 'none', anim);
    await rmCtx.close();

    // ---- away hero: clock-driven scene, not wake-window arc ----
    // Regression: with no prediction on the away gate (sp.prediction=null),
    // the wake-window arc fell into the 'elapsedMin > highMin' branch almost
    // immediately, so a 2pm away block rendered 'twilight' regardless of the
    // actual time of day. The away path in sceneSpec now picks a scene from
    // the clock hour. Pin the page clock to 14:00 and seed an ongoing away
    // block, then assert a daytime mode.
    const awayCtx = await browser.newContext({ viewport: { width: 360, height: 820 }, storageState });
    const awayPage = await awayCtx.newPage();
    await awayPage.route('**/api/sync*', (route) => route.abort());
    await awayPage.clock.install({ time: at(14) });
    await awayPage.goto(srv.base + '/');
    await onboard(awayPage);
    // Seed an away block that started 30 minutes before the (pinned) now —
    // elapsedMin=30 with highMin=0 used to resolve to 'twilight'.
    await seed(awayPage, { awayStartAgo: 30 });
    const awayMode = await skyMode(awayPage);
    check('2pm away hero renders a daytime sky mode, not twilight/night', ['morning', 'day', 'golden'].includes(awayMode), awayMode);
    const awayState = await awayPage.getAttribute('.card.hero', 'data-state');
    check('2pm away hero is in the away state', awayState === 'away', awayState);
    const awayLabel = await awayPage.$eval('.hero .state-lbl', (el) => el.textContent);
    check('2pm away hero shows "Away since…" copy', /Away since/.test(awayLabel), awayLabel);
    await awayCtx.close();
  } catch (e) {
    check('sky scene suite ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
