const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18809);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // Add a medicine first via the Home card's edit-pencil, so the log form's
    // <select> has at least one real option alongside the shortcut.
    await page.click('[data-action="card:edit"][data-card="medicine"]');
    await page.waitForSelector('#med-list');
    await page.click('[data-action="med:add"]');
    await page.fill('#med-list .med-edit:last-child .med-name', 'Tylenol');
    await page.click('[data-action="card:save-meds"]');
    await page.waitForTimeout(300);

    // Open the medicine log form and confirm the shortcut option is present.
    await page.click('[data-action="log:open"][data-type="medicine"]');
    await page.waitForSelector('#f-med');
    const optionValues = await page.$$eval('#f-med option', (els) => els.map((el) => el.value));
    check('medicine select has a real medicine option', optionValues.includes(optionValues[0]) && optionValues[0] !== '__manage__', optionValues.join(','));
    check('medicine select ends with the manage shortcut', optionValues[optionValues.length - 1] === '__manage__', optionValues.join(','));

    // Selecting the shortcut opens the manage-medicines sheet, not the log form.
    await page.selectOption('#f-med', '__manage__');
    await page.waitForSelector('#med-list', { timeout: 3000 });
    const sheetTitle = await page.$eval('.sheet-hd h3', (el) => el.textContent).catch(() => '');
    check('picking the shortcut opens the manage-medicines sheet', sheetTitle === 'Medicines', sheetTitle);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})();
