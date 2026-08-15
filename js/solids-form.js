// solids-form.js: row-scoped multi-food UI for the solids log form.
// Existing per-type-global helpers (seg/segVal/setSeg, iconGrid/setIconGrid)
// already scope by an arbitrary group-name string, so giving each food row
// a unique, row-id-suffixed group name lets them work unmodified here --
// this module is the row-aware wrapper around them, not a replacement.
import { $, $$, esc, seg, field, iconGrid } from './ui.js';
import { groupedCatalog, findFoodByKey } from './foods.js';

const AMOUNT_OPTS = ['None', 'Little', 'Some', 'Most', 'All'];
const REACTION_OPTS = [
  { val: 'hates', icon: 'frown', label: 'Hates it' },
  { val: 'unsure', icon: 'meh', label: 'Unsure' },
  { val: 'likes', icon: 'smile', label: 'Likes it' },
  { val: 'loves', icon: 'laugh', label: 'Loves it' },
];

function foodPickerOptions() {
  const opts = [];
  for (const { items } of groupedCatalog()) {
    for (const f of items) opts.push({ val: f.key, img: `assets/foods/${f.icon}.webp`, label: f.label });
  }
  opts.push({ val: '__other__', icon: 'utensils', label: 'Other' });
  return opts;
}

// Renders one food row. `prefillRow` (optional) is one element of an
// entry's `foods` array, used when editing an existing solids entry.
export function renderFoodRow(rowId, prefillRow) {
  const selectedFoodVal = prefillRow ? (prefillRow.key || '__other__') : null;
  const isCustom = !!(prefillRow && !prefillRow.key);
  const amountSel = prefillRow && prefillRow.amount ? prefillRow.amount : null;
  const isAmountCustom = !!(prefillRow && prefillRow.amountCustom);
  const reactionSel = prefillRow ? prefillRow.reaction : null;
  const allergyOn = !!(prefillRow && prefillRow.allergy);
  const customLabel = prefillRow && !prefillRow.key ? prefillRow.label : '';

  return `<div class="food-row" data-food-row="${rowId}">
    ${field('Food', iconGrid(`food-${rowId}`, foodPickerOptions(), selectedFoodVal))}
    <div class="food-custom-name" id="food-custom-${rowId}" ${isCustom ? '' : 'hidden'}>
      ${field('Food name', `<input type="text" id="f-food-custom-${rowId}" value="${esc(customLabel)}" placeholder="Type a food name" />`)}
    </div>
    ${field('Amount', seg(`amount-${rowId}`, AMOUNT_OPTS, isAmountCustom ? null : (amountSel || 'Some')))}
    <div class="food-amount-custom" id="amount-custom-${rowId}" ${isAmountCustom ? '' : 'hidden'}>
      ${field('Custom amount', `<input type="text" id="f-amount-custom-${rowId}" value="${esc(prefillRow && prefillRow.amountCustom || '')}" placeholder="e.g. 2 tbsp" />`)}
    </div>
    <button type="button" class="btn-ghost food-amount-toggle" data-action="foodrow:toggle-amount" data-row="${rowId}">Use custom amount instead</button>
    ${field('Reaction', iconGrid(`reaction-${rowId}`, REACTION_OPTS, reactionSel))}
    ${field('Allergy or sensitivity', `<button type="button" class="switch ${allergyOn ? 'on' : ''}" id="f-allergy-${rowId}" role="switch" aria-checked="${allergyOn}" data-action="form:toggle"><span class="knob"></span></button>`)}
    <button type="button" class="btn-ghost food-row-remove" data-action="solids:remove-row" data-row="${rowId}">Remove this food</button>
  </div>`;
}

// Reads every rendered row from the DOM and builds the entry's `foods`
// array. Called by sheets.js's gather() for type 'solid'.
export function gatherFoodRows() {
  const rows = $$('[data-food-row]');
  return [...rows].map((rowEl) => {
    const rowId = rowEl.dataset.foodRow;
    const foodSel = $(`[data-icongrid="food-${rowId}"] .icongrid-opt.on`);
    const foodVal = foodSel ? foodSel.dataset.val : null;
    const isCustom = foodVal === '__other__';
    const customInput = $(`#f-food-custom-${rowId}`);
    const key = isCustom ? null : foodVal;
    // For a catalog pick, store the catalog's display label ('Banana'), not
    // the raw catalog key ('banana') -- gatherFoodRows previously stored the
    // key itself here, which meant every non-custom row rendered its saved
    // label as the lowercase key instead of the proper display text.
    const catalogFood = !isCustom && foodVal ? findFoodByKey(foodVal) : null;
    const label = isCustom ? (customInput ? customInput.value.trim() : '') : (catalogFood ? catalogFood.label : (foodVal || ''));

    const amountCustomInput = $(`#f-amount-custom-${rowId}`);
    const amountCustomEl = $(`#amount-custom-${rowId}`);
    const amountCustomVisible = !!amountCustomEl && !amountCustomEl.hidden;
    const amountSel = $(`[data-seg="amount-${rowId}"] .seg-opt.on`);

    const reactionSel = $(`[data-icongrid="reaction-${rowId}"] .icongrid-opt.on`);
    const allergyEl = $(`#f-allergy-${rowId}`);

    return {
      key,
      label,
      amount: amountCustomVisible ? null : (amountSel ? amountSel.dataset.val : null),
      amountCustom: amountCustomVisible ? (amountCustomInput ? amountCustomInput.value.trim() : '') : null,
      reaction: reactionSel ? reactionSel.dataset.val : null,
      allergy: allergyEl ? allergyEl.classList.contains('on') : false,
    };
  }).filter((row) => row.key || row.label); // drop a row nobody picked a food for
}

// Replaces the row container's content with one row per element of an
// existing entry's `foods` array. Called by sheets.js's prefill() when
// editing a solid entry.
export function prefillFoodRows(foods) {
  const container = $('#food-rows');
  if (!container) return;
  const rows = foods && foods.length ? foods : [null]; // always show at least one row
  container.innerHTML = rows.map((row, i) => renderFoodRow(i, row)).join('');
}

export function nextFoodRowId() {
  const rows = $$('[data-food-row]');
  if (!rows.length) return 0;
  return Math.max(...[...rows].map((r) => Number(r.dataset.foodRow))) + 1;
}