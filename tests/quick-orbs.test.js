// tests/quick-orbs.test.js — Home's quick-action orbs (issue #232): the
// picker sheet can hide/show and reorder orbs, both persist across reload.
const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18798);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 820 });
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.waitForSelector('.actions');

    const orbTypes = async () => page.$$eval('.actions .act[data-type]', (els) => els.map((el) => el.dataset.type));

    const before = await orbTypes();
    check('Home starts with the default quick-action order', before[0] === 'sleep' && before.includes('hygiene'), before.join(','));

    // Long-press the orb row to open the picker (pointerdown + hold, no movement).
    await page.locator('.actions').scrollIntoViewIfNeeded();
    const actionsBox = await page.locator('.actions').boundingBox();
    await page.mouse.move(actionsBox.x + 10, actionsBox.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    await page.waitForSelector('.quick-list');

    // Hide "Bath": its checkbox toggles off and it drops out of Home's orb row.
    await page.click('[data-action="quick:toggle"][data-type="bath"]');
    await page.waitForTimeout(150);
    const bathRow = await page.$('.quick-row[data-quick="bath"]');
    const bathVisible = await bathRow.evaluate((el) => el.classList.contains('visible'));
    check('hiding an orb in the picker un-marks it visible', !bathVisible);

    // Drag "Feed"'s handle above "Sleep" to make it the new primary orb.
    const sleepRow = await page.$('.quick-row.visible[data-quick="sleep"]');
    const feedHandle = await page.$('.quick-row.visible[data-quick="feed"] .quick-drag');
    const sleepBox = await sleepRow.boundingBox();
    const feedBox = await feedHandle.boundingBox();
    await page.mouse.move(feedBox.x + feedBox.width / 2, feedBox.y + feedBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sleepBox.x + 10, sleepBox.y - 5, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.click('[data-action="sheet:close"]');
    await page.waitForTimeout(200);

    const afterEdit = await orbTypes();
    check('reordering in the picker moves Feed to the front on Home', afterEdit[0] === 'feed', afterEdit.join(','));
    check('hiding Bath removes it from Home', !afterEdit.includes('bath'), afterEdit.join(','));

    await page.reload();
    await page.waitForSelector('.actions');
    const afterReload = await orbTypes();
    check('quick-orb order and visibility persist across reload', JSON.stringify(afterReload) === JSON.stringify(afterEdit), afterReload.join(','));
  } catch (e) {
    check('quick-orbs test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
