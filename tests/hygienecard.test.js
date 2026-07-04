const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18807);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Hygiene isn't a default card: add it first.
    await page.click('[data-action="card:add"]');
    await page.waitForSelector('[data-action="card:pick"][data-type="hygiene"]');
    await page.click('[data-action="card:pick"][data-type="hygiene"]');
    await page.waitForTimeout(300);
    await page.waitForSelector('[data-card="hygiene"]');
    check('hygiene card appears after adding it', true);

    // Empty state: tapping the card opens the management sheet.
    await page.click('[data-action="hygiene:card"]');
    await page.waitForSelector('#hygiene-list', { timeout: 3000 });
    check('empty hygiene card opens the management sheet', true);

    // Add one item.
    await page.click('[data-action="hygiene:add"]');
    await page.fill('#hygiene-list .med-edit:last-child .hyg-name', 'Nail trim');
    await page.click('[data-action="card:save-hygiene"]');
    await page.waitForTimeout(300);

    // Single item: tapping the card logs directly.
    await page.click('[data-action="hygiene:card"]');
    await page.waitForTimeout(400);
    const toast1 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('single hygiene item logs directly with toast', toast1);

    const savedName = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      const e = st.log.find((x) => x.type === 'hygiene');
      return e ? e.name : undefined;
    });
    check('hygiene entry saves the item name', savedName === 'Nail trim', savedName);

    // Add a second item to test the multi-item picker.
    await page.click('[data-action="card:edit"][data-card="hygiene"]');
    await page.waitForSelector('#hygiene-list', { timeout: 3000 });
    await page.click('[data-action="hygiene:add"]');
    await page.fill('#hygiene-list .med-edit:last-child .hyg-name', 'Brush teeth');
    await page.click('[data-action="card:save-hygiene"]');
    await page.waitForTimeout(300);

    await page.click('[data-action="hygiene:card"]');
    await page.waitForSelector('[data-action="hygiene:log"]', { timeout: 3000 });
    check('multi-item hygiene card shows a picker', true);

    await page.click('[data-action="hygiene:log"]');
    await page.waitForTimeout(300);
    const toast2 = await page.$eval('#toast', el => el.classList.contains('show')).catch(() => false);
    check('picking a hygiene item logs with a toast', toast2);

    // Also reachable via the "More" type chooser.
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('[data-action="log:open"][data-type="hygiene"]', { timeout: 3000 });
    check('hygiene appears in the "More" type chooser', true);
  } catch (e) {
    check('hygiene card test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
