import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM + storage so timeline.js's imports resolve under Node.
class MemoryStorage { constructor(){this.s={};} getItem(k){return Object.prototype.hasOwnProperty.call(this.s,k)?this.s[k]:null;} setItem(k,v){this.s[k]=String(v);} removeItem(k){delete this.s[k];} }
globalThis.localStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { groupByDay } = await import('./timeline.js');

const dayMs = 86400000;
function isoAt(daysAgo, hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); d.setTime(d.getTime() - daysAgo * dayMs); return d.toISOString(); }

test('groupByDay buckets entries by local day, newest day first', () => {
  const entries = [
    { id: 'a', type: 'feed', start: isoAt(0, 9) },
    { id: 'b', type: 'sleep', start: isoAt(0, 14) },
    { id: 'c', type: 'diaper', start: isoAt(1, 10) },
    { id: 'd', type: 'bottle', start: isoAt(3, 8) },
  ];
  const groups = groupByDay(entries);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].label, 'Today');
  assert.equal(groups[1].label, 'Yesterday');
  // Today bucket: items newest-first → 14:00 (b) before 09:00 (a).
  assert.deepEqual(groups[0].items.map(e => e.id), ['b', 'a']);
  // Oldest group keeps its two items? No — group d alone.
  assert.equal(groups[2].items.length, 1);
  assert.equal(groups[2].items[0].id, 'd');
  // Dated label format for the 3-days-ago group is non-empty and not Today/Yesterday.
  assert.ok(groups[2].label && !['Today', 'Yesterday'].includes(groups[2].label));
});

test('groupByDay returns [] for no entries', () => {
  assert.deepEqual(groupByDay([]), []);
});
