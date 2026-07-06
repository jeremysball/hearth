const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

(async () => {
  const srv = await startServer(18792);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);
    await page.click('[data-action="log:open"][data-type="sleep"]');
    await page.waitForSelector('#f-time-date');
    const dateVal = await page.$eval('#f-time-date', el => el.value);
    const timeVal = await page.$eval('#f-time-time', el => el.value);
    check('sleep sheet #f-time-date has a full date value', /^\d{4}-\d{2}-\d{2}$/.test(dateVal), dateVal);
    check('sleep sheet #f-time-time has a full time value', /^\d{2}:\d{2}$/.test(timeVal), timeVal);
    const endDateVal = await page.$eval('#f-end-date', el => el.value);
    const endTimeVal = await page.$eval('#f-end-time', el => el.value);
    check('sleep sheet #f-end-date defaults to today, not blank', /^\d{4}-\d{2}-\d{2}$/.test(endDateVal), endDateVal);
    check('sleep sheet #f-end-time starts blank', endTimeVal === '', endTimeVal);
  } catch (e) {
    check('datetime test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
