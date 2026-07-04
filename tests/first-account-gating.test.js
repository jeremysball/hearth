const { startServer, launchBrowser, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18810);
  const browser = await launchBrowser();
  try {
    // Fresh DB: root load shows the onboarding form.
    const freshPage = await browser.newPage();
    await freshPage.goto(srv.base + '/');
    await freshPage.waitForSelector('.onboard');
    const nameField = await freshPage.$('#onb-name');
    check('fresh instance shows the onboarding form with a baby-name field', !!nameField);
    await freshPage.close();

    // Provision the instance directly against the server.
    const createRes = await fetch(srv.base + '/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ babyName: 'Mira', birthdate: '2026-01-01', theme: 'girl', caregiverName: 'Maya' }),
    });
    check('seeding a family via the API succeeds', createRes.ok, createRes.status);

    // A second POST /api/family is rejected with 409.
    const secondRes = await fetch(srv.base + '/api/family', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ babyName: 'Otis', birthdate: '2026-02-02', theme: 'boy', caregiverName: 'Sam' }),
    });
    check('a second family create via the API is rejected', secondRes.status === 409, secondRes.status);

    // A fresh browser context (no local state) loading root now sees the provisioned view.
    const secondPage = await browser.newPage();
    await secondPage.goto(srv.base + '/');
    await secondPage.waitForSelector('.onboard');
    const nameFieldAfter = await secondPage.$('#onb-name');
    check('provisioned instance hides the baby-name field', !nameFieldAfter);
    const signInButtons = await secondPage.$$('[data-action^="auth:"]');
    check('provisioned instance shows sign-in buttons', signInButtons.length > 0, signInButtons.length);
    await secondPage.close();
  } catch (e) {
    check('first-account-gating test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
