const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18795);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    // Add Bath card via card picker.
    await page.click('[data-action="card:add"]');
    await page.waitForSelector('.chooser');
    await page.click('[data-action="card:pick"][data-type="bath"]');
    await page.waitForTimeout(300);
    // Bath card should now show with "Never" state.
    const cardVisible = await page.$('[data-card="bath"]') !== null;
    check('bath card appears after adding', cardVisible);
    const val = await page.$eval('[data-card="bath"] .ic-val', el => el.textContent.trim()).catch(() => '');
    check('bath card shows Never when no bath logged', val === 'Never', val);
    // Tap the card to open the bath log sheet.
    await page.click('[data-card="bath"]');
    await page.waitForSelector('.scrim.show', { timeout: 3000 });
    const sheetVisible = await page.$('.scrim.show') !== null;
    check('tapping bath card opens log sheet', sheetVisible);
  } catch (e) {
    check('bathcard test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
