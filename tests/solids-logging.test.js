const { startServer, launchBrowser, onboard, check, tally } = require('./helpers');

const readSolids = (page) => page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
  return st.log.filter((x) => x.type === 'solid');
});

// The time field has minute precision, so several entries logged in one test
// run share a `start` and the log's sort order can't tell them apart —
// identify the entry a save just created by diffing ids instead.
const solidIds = async (page) => (await readSolids(page)).map((e) => e.id);
async function saveSolid(page, idsBefore) {
  await page.click('[data-action="log:save"][data-type="solid"]');
  await page.waitForTimeout(300);
  return (await readSolids(page)).find((e) => !idsBefore.includes(e.id));
}

// Solids has no Home quick-action button, so every sheet in this spec opens
// through the "More" type chooser, the same route a parent takes.
async function openSolidSheet(page) {
  await page.click('[data-action="log:more"]');
  await page.waitForSelector('.chooser [data-action="log:open"][data-type="solid"]');
  await page.click('.chooser [data-action="log:open"][data-type="solid"]');
  await page.waitForSelector('#food-rows [data-food-row="0"]');
}

async function openEntryForEdit(page, id) {
  await page.click(`[data-id="${id}"]`);
  await page.waitForSelector('[data-action="entry:edit"]');
  await page.click('[data-action="entry:edit"]');
  await page.waitForSelector('#food-rows [data-food-row="0"]');
}

(async () => {
  const srv = await startServer(18815);
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(srv.base + '/');
    await onboard(page);

    // ---- the type chooser offers Solids ----
    await page.click('[data-action="log:more"]');
    await page.waitForSelector('.chooser');
    const solidTileLabel = await page.$eval('.chooser [data-action="log:open"][data-type="solid"]', (el) => el.textContent.trim());
    check('the log-type chooser shows a Solids tile', solidTileLabel.includes('Solids'), solidTileLabel);
    await page.click('.chooser [data-action="log:open"][data-type="solid"]');
    await page.waitForSelector('#food-rows [data-food-row="0"]');

    // ---- one food ----
    const beforeOne = await solidIds(page);
    await page.click('[data-icongrid="food-0"] .icongrid-opt[data-val="banana"]');
    await page.click('[data-seg="amount-0"] .seg-opt[data-val="Most"]');
    await page.click('[data-icongrid="reaction-0"] .icongrid-opt[data-val="loves"]');
    const oneFood = await saveSolid(page, beforeOne);
    check('logging one food saves a solid entry', !!oneFood, JSON.stringify(oneFood));
    check('a one-food entry saves foods as a single-element array', oneFood && oneFood.foods && oneFood.foods.length === 1, JSON.stringify(oneFood && oneFood.foods));
    check('the saved row carries the picked catalog key and display label', oneFood && oneFood.foods[0].key === 'banana' && oneFood.foods[0].label === 'Banana', JSON.stringify(oneFood && oneFood.foods[0]));
    check('the saved row carries the picked amount from the segmented control', oneFood && oneFood.foods[0].amount === 'Most', JSON.stringify(oneFood && oneFood.foods[0]));
    check('the saved row carries the picked reaction from the icon grid', oneFood && oneFood.foods[0].reaction === 'loves', JSON.stringify(oneFood && oneFood.foods[0]));
    check('the saved row defaults allergy to false', oneFood && oneFood.foods[0].allergy === false, JSON.stringify(oneFood && oneFood.foods[0]));
    check('the saved row leaves amountCustom null when the scale is used', oneFood && oneFood.foods[0].amountCustom === null, JSON.stringify(oneFood && oneFood.foods[0]));
    check('a solid entry stores its timestamp as `start`, not `time`', !!(oneFood && oneFood.start) && oneFood.time === undefined, JSON.stringify(oneFood && { start: oneFood.start, time: oneFood.time }));

    // ---- Home's Solids card sub-label lists the last meal's foods, not just a count ----
    const solidCardVal = await page.$eval('[data-card="solid"] .ic-val', (el) => el.textContent.trim());
    check('the Solids card shows the last entry\'s foods, not just a count', solidCardVal === 'Banana', solidCardVal);

    // ---- two foods, independent per-row values ----
    await openSolidSheet(page);
    const beforeTwo = await solidIds(page);
    await page.click('[data-icongrid="food-0"] .icongrid-opt[data-val="banana"]');
    await page.click('[data-seg="amount-0"] .seg-opt[data-val="Some"]');
    await page.click('[data-icongrid="reaction-0"] .icongrid-opt[data-val="likes"]');
    await page.click('[data-action="solids:add-row"]');
    await page.waitForSelector('#food-rows [data-food-row="1"]');
    await page.click('[data-icongrid="food-1"] .icongrid-opt[data-val="carrot"]');
    await page.click('[data-seg="amount-1"] .seg-opt[data-val="Little"]');
    await page.click('[data-icongrid="reaction-1"] .icongrid-opt[data-val="hates"]');
    await page.click('#f-allergy-1');
    const twoFood = await saveSolid(page, beforeTwo);
    check('adding a second row saves two foods', twoFood && twoFood.foods.length === 2, JSON.stringify(twoFood && twoFood.foods));
    check('the two rows keep their own food, amount and reaction', twoFood
      && twoFood.foods[0].key === 'banana' && twoFood.foods[0].amount === 'Some' && twoFood.foods[0].reaction === 'likes'
      && twoFood.foods[1].key === 'carrot' && twoFood.foods[1].amount === 'Little' && twoFood.foods[1].reaction === 'hates',
    JSON.stringify(twoFood && twoFood.foods));
    check('an allergy flag on the second row does not leak onto the first', twoFood && twoFood.foods[0].allergy === false && twoFood.foods[1].allergy === true, JSON.stringify(twoFood && twoFood.foods.map((f) => f.allergy)));
    const twoFoodId = twoFood.id;

    // ---- custom food ("Other") ----
    await openSolidSheet(page);
    const beforeCustomFood = await solidIds(page);
    await page.click('[data-icongrid="food-0"] .icongrid-opt[data-val="__other__"]');
    const otherPicked = await page.$eval('[data-icongrid="food-0"] .icongrid-opt.on', (el) => el.dataset.val);
    check('picking the Other tile selects it', otherPicked === '__other__', otherPicked);
    const revealedByPick = await page.$eval('#food-custom-0', (el) => !el.hidden);
    check('picking the Other tile reveals the custom-name field', revealedByPick);
    await page.fill('#f-food-custom-0', 'Grandma congee');
    const customFood = await saveSolid(page, beforeCustomFood);
    check('a custom food saves key: null', customFood && customFood.foods[0].key === null, JSON.stringify(customFood && customFood.foods[0]));
    check('a custom food saves the typed name as its label', customFood && customFood.foods[0].label === 'Grandma congee', JSON.stringify(customFood && customFood.foods[0]));
    const customFoodId = customFood.id;

    // ---- custom amount ----
    await openSolidSheet(page);
    const beforeCustomAmount = await solidIds(page);
    await page.click('[data-icongrid="food-0"] .icongrid-opt[data-val="oatmeal"]');
    await page.click('[data-action="foodrow:toggle-amount"][data-row="0"]');
    const amountScaleHidden = await page.$eval('[data-seg="amount-0"]', (el) => el.closest('.fld').hidden);
    check('toggling a custom amount hides the amount scale', amountScaleHidden);
    await page.fill('#f-amount-custom-0', '2 tbsp');
    const customAmount = await saveSolid(page, beforeCustomAmount);
    check('a custom amount saves amount: null', customAmount && customAmount.foods[0].amount === null, JSON.stringify(customAmount && customAmount.foods[0]));
    check('a custom amount saves the typed text as amountCustom', customAmount && customAmount.foods[0].amountCustom === '2 tbsp', JSON.stringify(customAmount && customAmount.foods[0]));

    // ---- editing a two-food entry prefills both rows ----
    await openEntryForEdit(page, twoFoodId);
    const rowCount = await page.$$eval('#food-rows [data-food-row]', (els) => els.length);
    check('editing a two-food entry renders two rows', rowCount === 2, rowCount);
    const prefilled = await page.evaluate(() => [...document.querySelectorAll('#food-rows [data-food-row]')].map((row) => {
      const id = row.dataset.foodRow;
      const on = (sel) => { const el = row.querySelector(sel); return el ? el.dataset.val : null; };
      const allergy = row.querySelector(`#f-allergy-${id}`);
      return {
        food: on(`[data-icongrid="food-${id}"] .icongrid-opt.on`),
        amount: on(`[data-seg="amount-${id}"] .seg-opt.on`),
        reaction: on(`[data-icongrid="reaction-${id}"] .icongrid-opt.on`),
        allergy: !!allergy && allergy.classList.contains('on'),
      };
    }));
    check('editing prefills the first row with its saved values', prefilled[0] && prefilled[0].food === 'banana' && prefilled[0].amount === 'Some' && prefilled[0].reaction === 'likes' && prefilled[0].allergy === false, JSON.stringify(prefilled[0]));
    check('editing prefills the second row with its own saved values', prefilled[1] && prefilled[1].food === 'carrot' && prefilled[1].amount === 'Little' && prefilled[1].reaction === 'hates' && prefilled[1].allergy === true, JSON.stringify(prefilled[1]));

    // Re-saving an edited entry keeps both rows rather than collapsing them.
    await page.click('[data-action="log:save"][data-type="solid"]');
    await page.waitForTimeout(300);
    const resaved = await page.evaluate((id) => {
      const st = JSON.parse(localStorage.getItem('hearth.state.v1'));
      return st.log.find((x) => x.id === id);
    }, twoFoodId);
    check('re-saving an edited two-food entry keeps both rows', resaved && resaved.foods.length === 2, JSON.stringify(resaved && resaved.foods));

    // ---- editing a custom-food entry prefills the revealed name field ----
    await openEntryForEdit(page, customFoodId);
    const customVisible = await page.$eval('#food-custom-0', (el) => !el.hidden);
    const customValue = await page.$eval('#f-food-custom-0', (el) => el.value);
    check('editing a custom-food entry reveals the food-name field', customVisible);
    check('editing a custom-food entry prefills the typed name', customValue === 'Grandma congee', customValue);

    // ---- Today's log row lists the foods inline, same "· " divider other cards use ----
    const twoFoodRowLabel = await page.$eval(`.row[data-id="${twoFoodId}"] .what`, (el) => el.textContent.trim());
    check('a two-food entry\'s row shows "Solids · food, food"', twoFoodRowLabel === 'Solids · Banana, Carrot', twoFoodRowLabel);
  } catch (e) {
    check('solids logging test ran without throwing', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(tally());
})().catch((e) => { console.error(e); process.exit(1); });
