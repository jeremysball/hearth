const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Track /api/sync calls by wrapping window.fetch in-page rather than via
    // Playwright's page.on('request'): under CI, that CDP-level listener can
    // silently miss a fetch that the app itself confirms completed (verified
    // via the app's own debug logging) — an unreliable-tracking quirk in this
    // headless build, not an app bug. Counting inside the page sidesteps it.
    await page.addInitScript(() => {
      window.__syncHits = 0;
      const origFetch = window.fetch;
      window.fetch = (...args) => {
        try {
          const url = args[0] instanceof Request ? args[0].url : args[0];
          if (new URL(url, location.href).pathname === '/api/sync') window.__syncHits++;
        } catch {}
        return origFetch(...args);
      };
    });
    const syncHits = () => page.evaluate(() => window.__syncHits);

    await page.goto(srv.base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await onboard(page);
    // Let the initial sync + SSE connection settle. 2s is well under the
    // 15s passive poll, so no interval-driven sync fires in this window.
    await page.waitForTimeout(2000);
    const baseline = await syncHits();

    // Dispatch a synthetic visibilitychange. The app's listener guards on
    // `document.visibilityState === 'visible'` (js/app.js), but headless
    // Chromium's real visibilityState tracks browser/OS-level occlusion —
    // a page with no focused window can report 'hidden' even though nothing
    // in the test ever backgrounded it. A dispatched Event can't change that
    // read-only property, so stub it before dispatching to make the guard
    // deterministic instead of dependent on the runner's window-focus state.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Poll instead of a fixed wait: syncOnce() drains the outbox before its
    // pull fetch, and under CI load that round trip can take longer than a
    // fixed 2s window even though it always completes well within a few
    // seconds.
    const deadline = Date.now() + 5000;
    let hits = await syncHits();
    while (hits <= baseline && Date.now() < deadline) {
      await page.waitForTimeout(50);
      hits = await syncHits();
    }

    check('visibilitychange triggers syncOnce', hits > baseline, `${hits - baseline} sync requests after foreground (baseline ${baseline})`);
  } catch (e) {
    check('visibility-sync test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });