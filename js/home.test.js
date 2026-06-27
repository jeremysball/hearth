import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage so home.js's imports resolve under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { bathDaysSinceLabel } = await import('./home.js');

const atDaysAgo = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() - n); return d.toISOString(); };

test('bathDaysSinceLabel returns Never for no entry', () => {
  assert.equal(bathDaysSinceLabel(null), 'Never');
});
test('bathDaysSinceLabel returns Today for an entry earlier today', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(0)), 'Today');
});
test('bathDaysSinceLabel returns Yesterday for one calendar day ago', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(1)), 'Yesterday');
});
test('bathDaysSinceLabel returns N days ago for older entries', () => {
  assert.equal(bathDaysSinceLabel(atDaysAgo(3)), '3 days ago');
});
