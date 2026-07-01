const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18799);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Track /api/sync requests from the very start so we can compare
    // against a baseline taken after the initial sync settles. Match on
    // pathname so the counter is robust to query-string changes.
    let syncHits = 0;
    page.on('request', (req) => {
      try {
        if (new URL(req.url()).pathname === '/api/sync') syncHits++;
      } catch {}
    });

    await page.goto(srv.base + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await onboard(page);
    // Let the initial sync + SSE connection settle. 2s is well under the
    // 15s passive poll, so no interval-driven sync fires in this window.
    await page.waitForTimeout(2000);
    const baseline = syncHits;

    // Dispatch a synthetic visibilitychange. The page is already visible,
    // so the listener's guard passes and syncOnce fires.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(2000);

    check('visibilitychange triggers syncOnce', syncHits > baseline, `${syncHits - baseline} sync requests after foreground (baseline ${baseline})`);
  } catch (e) {
    check('visibility-sync test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });