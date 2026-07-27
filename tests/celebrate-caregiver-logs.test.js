const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18812);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('[data-path="settings.celebrateCaregiverLogs"]');

    const isOn = () => page.$eval('[data-path="settings.celebrateCaregiverLogs"]', (el) => el.classList.contains('on'));
    check('celebrate-caregiver-logs toggle defaults on', await isOn(), 'expected default true');

    // Track /api/settings pushes the same way visibility-sync.test.js tracks
    // /api/sync: this setting must stay device-local like sound/darkMode, not
    // sync to other caregivers who may want a different preference.
    await page.evaluate(() => {
      window.__settingsHits = 0;
      const origFetch = window.fetch;
      window.fetch = (...args) => {
        try {
          const url = args[0] instanceof Request ? args[0].url : args[0];
          if (new URL(url, location.href).pathname === '/api/settings') window.__settingsHits++;
        } catch {}
        return origFetch(...args);
      };
    });

    await page.click('[data-path="settings.celebrateCaregiverLogs"]');
    await page.waitForTimeout(200);
    check('toggle switches off after a tap', !(await isOn()), 'expected off');

    const settingsHits = await page.evaluate(() => window.__settingsHits);
    check('toggling it does not push to /api/settings', settingsHits === 0, `${settingsHits} pushes`);

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('hearth.state.v1')).settings.celebrateCaregiverLogs);
    check('the off state persists to local storage', persisted === false, persisted);

    await page.reload();
    await page.click('[data-action="nav:profile"]');
    await page.waitForSelector('[data-path="settings.celebrateCaregiverLogs"]');
    check('the off state survives a reload', !(await isOn()), 'expected still off');
  } catch (e) {
    check('celebrate-caregiver-logs test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
