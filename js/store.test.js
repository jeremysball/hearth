import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

const { state, addEntry, removeEntry, addMeasure, applySyncResponse } = await import('./store.js');

function outboxOps() {
  return JSON.parse(localStorage.getItem('hearth.outbox.v1') || '[]');
}

test('addEntry enqueues a PUT to /api/entries/:id', () => {
  const before = outboxOps().length;
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  const ops = outboxOps();
  assert.equal(ops.length, before + 1);
  const last = ops[ops.length - 1];
  assert.equal(last.url, '/api/entries/' + e.id);
  assert.equal(last.method, 'PUT');
  assert.equal(last.body.id, e.id);
});

test('removeEntry enqueues a DELETE to /api/entries/:id', () => {
  const e = addEntry({ type: 'diaper', start: '2026-01-01T00:00:00Z' });
  removeEntry(e.id);
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'DELETE');
  assert.equal(last.url, '/api/entries/' + e.id);
});

test('addMeasure enqueues a PUT to /api/growth/:id', () => {
  const m = addMeasure({ date: '2026-06-20', weightKg: 7.3 });
  const last = outboxOps().at(-1);
  assert.equal(last.method, 'PUT');
  assert.equal(last.url, '/api/growth/' + m.id);
});

test('applySyncResponse merges baby and settings fields', () => {
  applySyncResponse({ baby: { name: 'Olive', theme: 'boy' }, settings: { bottleIntervalH: 4 }, entries: [], growth: [] });
  assert.equal(state().baby.name, 'Olive');
  assert.equal(state().baby.theme, 'boy');
  assert.equal(state().settings.bottleIntervalH, 4);
});

test('applySyncResponse upserts and tombstones log entries by id', () => {
  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', type: 'sleep', start: '2026-01-01T00:00:00Z' }], growth: [] });
  assert.ok(state().log.find((e) => e.id === 'sync-e1'));

  applySyncResponse({ baby: null, settings: null, entries: [{ id: 'sync-e1', deletedAt: '2026-01-02T00:00:00Z' }], growth: [] });
  assert.equal(state().log.find((e) => e.id === 'sync-e1'), undefined);
});
