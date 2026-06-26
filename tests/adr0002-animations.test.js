// tests/adr0002-animations.test.js — WAAPI enter animations on tab switch.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer(18792);
  let exitCode = 0;
  try { exitCode = await runSuite(server.base); }
  catch (e) { console.error(e); exitCode = 1; }
  finally { server.close(); }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  resetCounters();

  // ---- Seed growth data so the chart renders ----
  // (lineChart() requires at least 2 measurements)
  await page.evaluate(() => {
    const KEY = 'hearth.state.v1';
    const st = JSON.parse(localStorage.getItem(KEY) || '{}');
    st.growth = [
      { id: 'g1', date: '2025-06-01', weightKg: 3.5, heightCm: 52, headCm: null, note: '' },
      { id: 'g2', date: '2025-08-01', weightKg: 5.2, heightCm: 60, headCm: null, note: '' }
    ];
    localStorage.setItem(KEY, JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await onboard(page);
  await page.waitForTimeout(300);

  // ---------- Trends: bars animate scaleY on tab switch ----------
  console.log('--- Animations: Trends bars animate on tab switch ---');
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(50); // check early — animations run for 450ms+stagger

  const barAnimCount = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('.bar')];
    return bars.reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  active bar animations immediately after nav:', barAnimCount);
  check('trends bars have active WAAPI animations after tab switch', barAnimCount > 0, barAnimCount);

  // Wait for all animations to finish (450ms + 20*35ms stagger ≈ 1150ms total for 21 bars across 3 charts)
  await page.waitForTimeout(1500);
  const barsDone = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('.bar')];
    const anims = bars.flatMap(b => b.getAnimations());
    return { total: anims.length, finished: anims.filter(a => a.playState === 'finished').length };
  });
  console.log('  bar animation states after 900ms:', barsDone);
  // finished + running <= total; finished > 0 means at least some ran
  check('bar animations complete (not stuck)', barsDone.finished === barsDone.total || barsDone.total === 0, JSON.stringify(barsDone));

  // ---------- Trends: second tab switch replays the animation ----------
  console.log('\n--- Animations: replay on every tab switch ---');
  await page.click('[data-action="nav:home"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(50);
  const barAnimCount2 = await page.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  check('trends bars animate again on second tab switch', barAnimCount2 > 0, barAnimCount2);

  // ---------- Sleep: ring segments animate stroke-dasharray ----------
  console.log('\n--- Animations: Sleep ring segments animate ---');
  // Add a sleep entry so at least one ring segment renders
  await page.evaluate(() => {
    const KEY = 'hearth.state.v1';
    const st = JSON.parse(localStorage.getItem(KEY) || '{}');
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 60 * 1000).toISOString(); // 90min ago
    const end = new Date(now.getTime() - 30 * 60 * 1000).toISOString();   // 30min ago
    st.log = [...(st.log || []), { id: 'sl1', type: 'sleep', start, end, quality: 'Good' }];
    localStorage.setItem(KEY, JSON.stringify(st));
  });
  await page.click('[data-action="nav:home"]');
  await page.waitForTimeout(100);
  await page.click('[data-action="nav:sleep"]');
  await page.waitForTimeout(50);

  const ringAnimCount = await page.evaluate(() => {
    const circles = [...document.querySelectorAll('.ringwrap svg circle[stroke-dasharray]')];
    return circles.reduce((n, c) => n + c.getAnimations().length, 0);
  });
  console.log('  active ring segment animations:', ringAnimCount);
  check('sleep ring segments have active WAAPI animations', ringAnimCount > 0, ringAnimCount);

  // ---------- Growth: polyline and circles animate ----------
  console.log('\n--- Animations: Growth polyline and dots animate ---');
  await page.click('[data-action="nav:growth"]');
  await page.waitForTimeout(50);

  const growthAnims = await page.evaluate(() => {
    const poly = document.querySelector('.growth-svg polyline');
    const circles = [...document.querySelectorAll('.growth-svg circle')];
    const polygon = document.querySelector('.growth-svg polygon');
    return {
      poly: poly?.getAnimations().length ?? 0,
      circles: circles.reduce((n, c) => n + c.getAnimations().length, 0),
      polygon: polygon?.getAnimations().length ?? 0
    };
  });
  console.log('  growth animation counts:', growthAnims);
  check('growth polyline animates', growthAnims.poly > 0, growthAnims.poly);
  check('growth dots animate', growthAnims.circles > 0, growthAnims.circles);
  check('growth area polygon animates', growthAnims.polygon > 0, growthAnims.polygon);

  // ---------- refresh() does NOT trigger animations ----------
  console.log('\n--- Animations: refresh() does NOT replay animations ---');
  await page.click('[data-action="nav:trends"]');
  await page.waitForTimeout(700); // let initial tab-switch animations finish
  await page.evaluate(async () => {
    const mod = await import('/js/app.js');
    mod.router.refresh();
  });
  await page.waitForTimeout(50);
  const barAnimAfterRefresh = await page.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  bar animations after router.refresh():', barAnimAfterRefresh);
  check('router.refresh() does NOT trigger bar animations', barAnimAfterRefresh === 0, barAnimAfterRefresh);

  // ---------- Reduced motion: no animations ----------
  console.log('\n--- Animations: prefers-reduced-motion suppresses all animations ---');
  const page2 = await browser.newPage();
  await page2.emulateMedia({ reducedMotion: 'reduce' });
  await page2.goto(base + '/', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(500);
  await onboard(page2);
  await page2.waitForTimeout(300);

  await page2.click('[data-action="nav:trends"]');
  await page2.waitForTimeout(100);
  const reducedBarAnims = await page2.evaluate(() => {
    return [...document.querySelectorAll('.bar')].reduce((n, b) => n + b.getAnimations().length, 0);
  });
  console.log('  bar animations under reduced-motion:', reducedBarAnims);
  check('no bar animations under prefers-reduced-motion', reducedBarAnims === 0, reducedBarAnims);
  await page2.close();

  const exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
