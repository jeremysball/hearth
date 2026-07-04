import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener: () => {}, removeEventListener: () => {},
  createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } }),
  body: { appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
  documentElement: { style: {}, setAttribute: () => {}, getAttribute: () => null, addEventListener: () => {}, removeEventListener: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
  visibilityState: 'visible'
};
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
// sheets.js transitively imports app.js, which schedules real setInterval
// timers (sync polling, minute tick) at module load time. Those timers keep
// the Node process alive forever under `node --test`, hanging CI. This test
// only needs iconGrid()'s synchronous string output, so no timer ever needs
// to actually fire — stub setInterval out before the import.
globalThis.setInterval = () => 0;
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { iconGrid } = await import('./sheets.js');

test('iconGrid renders one button per option with the right icon and selected state', () => {
  const html = iconGrid('method', [
    { val: 'Nursing', icon: 'milk', label: 'Nursing' },
    { val: 'Car', icon: 'car', label: 'Car' }
  ], 'Car');
  assert.match(html, /data-icongrid="method"/);
  assert.match(html, /data-val="Nursing"/);
  assert.match(html, /href="#milk"/);
  assert.match(html, /data-val="Car"[^>]*class="icongrid-opt on"|class="icongrid-opt on"[^>]*data-val="Car"/);
});

test('iconGrid HTML-escapes option values', () => {
  const html = iconGrid('method', [{ val: '<x>', icon: 'car', label: '<y>' }], null);
  assert.ok(!html.includes('<x>'));
  assert.ok(!html.includes('<y>'));
});
