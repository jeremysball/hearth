// tests/persistence.test.js — a spinner-set value must survive the full
// round trip (save -> reopen -> server), not just look right in the DOM.
// Regression target: PR #3 switched the stepper's storage from `.value` to
// `.dataset.value`/`.textContent` everywhere (gather/prefill/stepValue) — the
// widget tests in spinner.test.js cover drag/momentum behavior in detail but
// never exercise that read/write path through a save.
const { startServer, launchBrowser, onboard, check, tally, resetCounters } = require('./helpers');

(async () => {
  const server = await startServer();
  let exitCode = 0;
  try {
    exitCode = await runSuite(server.base);
  } catch (e) {
    console.error(e);
    exitCode = 1;
  } finally {
    server.close();
  }
  process.exit(exitCode);
})().catch((e) => { console.error(e); process.exit(1); });

async function runSuite(base) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await onboard(page);

  resetCounters();

  console.log('--- Persistence: spun amount survives save, UI reopen, and server sync ---');

  await page.click('[data-action="log:open"][data-type="bottle"]');
  await page.waitForTimeout(500);
  await page.click('.stepper-val');
  await page.waitForTimeout(300);

  const overlay = await page.$('.spinner-overlay');
  const win = await (await overlay.$('.spinner-window')).boundingBox();
  const cx = win.x + win.width / 2;
  const cy = win.y + win.height / 2;
  const itemH = (await (await overlay.$('.spinner-item')).boundingBox()).height;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - itemH * 3, { steps: 12 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(700);

  const spunValue = await (await page.$('.stepper-val')).getAttribute('data-value');
  console.log('  spun amount:', spunValue, 'ml');
  check('spin actually changed the amount off its default', spunValue !== '120', spunValue);

  // Tap outside the popup to dismiss the overlay (it only closes on a
  // backdrop click, not automatically after settling) before saving.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);

  await page.click('[data-action="log:save"]');
  await page.waitForTimeout(600);

  // The new entry is timestamped "now", so it sorts to the top of today's list.
  const savedId = await page.$eval('.row[data-action="entry:open"]', el => el.dataset.id);
  const rowMeta = await page.$eval('.row[data-action="entry:open"] .meta', el => el.textContent);
  console.log('  new row meta:', rowMeta);
  check('home row reflects the spun amount', rowMeta.includes(spunValue), rowMeta);

  // ---------- Reopen via the real UI path: tap the row, then Edit ----------
  await page.click(`.row[data-id="${savedId}"]`);
  await page.waitForTimeout(400);
  await page.click(`[data-action="entry:edit"][data-id="${savedId}"]`);
  await page.waitForTimeout(400);
  const reopenedValue = await page.$eval('#f-amt', el => el.dataset.value);
  console.log('  amount after reopening the saved entry:', reopenedValue);
  check('reopened entry shows the spun amount', reopenedValue === spunValue, `expected ${spunValue}, got ${reopenedValue}`);
  await page.click('[data-action="sheet:close"]');
  await page.waitForTimeout(400);

  // ---------- Reopen from the server: reload triggers the app's own sync,
  // then ask the server directly for its copy of the entry. ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const serverEntry = await page.evaluate(async (id) => {
    const res = await fetch('/api/sync?since=', { credentials: 'include' });
    const data = await res.json();
    return (data.entries || []).find(e => e.id === id);
  }, savedId);
  console.log('  server copy of the entry:', serverEntry);
  check('server stored the spun amount, not a stale/default one',
    !!serverEntry && serverEntry.amount === Number(spunValue),
    serverEntry ? serverEntry.amount : 'not found');

  exitCode = tally() === 0 ? 0 : 1;
  await browser.close();
  return exitCode;
}
