// Order-of-persistence repro for the symptom "gf's entries sometimes don't
// sync to the other caregiver". addEntry, updateEntry, removeEntry,
// addMeasure, and removeMeasure all used to write the new state to
// localStorage BEFORE writing the outbox op. The two writes are to separate
// keys, so a process kill that lands in the microsecond window between them
// (mobile OS reaping a backgrounded PWA, browser tab crash) left the entry
// visible to the logging caregiver but with no op queued to upload it — the
// other caregiver never saw it. Same user-facing symptom as the drainOutbox
// race that was just fixed.
//
// Fix: persist the outbox op FIRST, then the state. The "intent to sync"
// survives even if the "local view" write is lost; the state catches up
// from the next pull after the drain succeeds.
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; this.setOrder = []; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.setOrder.push(k); this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}

function installStorage() {
  const s = new MemoryStorage();
  globalThis.localStorage = s;
  return s;
}

globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: () => {} });

const { addEntry, removeEntry, updateEntry, addMeasure, removeMeasure, state } = await import('./store.js');

function outboxOps() {
  return JSON.parse(localStorage.getItem('hearth.outbox.v1') || '[]');
}

test('addEntry persists the outbox op BEFORE the state (crash window no longer loses the op)', () => {
  installStorage();
  addEntry({ type: 'bottle', start: '2026-01-01T10:00:00Z', amount: 120 });
  const stateIdx = localStorage.setOrder.indexOf('hearth.state.v1');
  const outboxIdx = localStorage.setOrder.indexOf('hearth.outbox.v1');
  assert.ok(outboxIdx !== -1, 'outbox was persisted');
  assert.ok(stateIdx !== -1, 'state was persisted');
  assert.ok(outboxIdx < stateIdx,
    `outbox (idx ${outboxIdx}) must be written before state (idx ${stateIdx}); a crash between now loses the state, not the outbox op`);
});

test('updateEntry persists the outbox op BEFORE the state', () => {
  installStorage();
  const e = addEntry({ type: 'bottle', start: '2026-01-01T10:00:00Z', amount: 120 });
  localStorage.setOrder = [];
  updateEntry(e.id, { amount: 150 });
  const stateIdx = localStorage.setOrder.indexOf('hearth.state.v1');
  const outboxIdx = localStorage.setOrder.indexOf('hearth.outbox.v1');
  assert.ok(outboxIdx < stateIdx,
    `outbox (idx ${outboxIdx}) must be written before state (idx ${stateIdx})`);
});

test('removeEntry persists the outbox op BEFORE the state', () => {
  installStorage();
  const e = addEntry({ type: 'bottle', start: '2026-01-01T10:00:00Z', amount: 120 });
  localStorage.setOrder = [];
  removeEntry(e.id);
  const stateIdx = localStorage.setOrder.indexOf('hearth.state.v1');
  const outboxIdx = localStorage.setOrder.indexOf('hearth.outbox.v1');
  assert.ok(outboxIdx < stateIdx,
    `outbox (idx ${outboxIdx}) must be written before state (idx ${stateIdx})`);
});

test('addMeasure and removeMeasure persist the outbox op BEFORE the state', () => {
  installStorage();
  addMeasure({ id: 'm-test', date: '2026-01-01', weightKg: 7.5 });
  const addStateIdx = localStorage.setOrder.indexOf('hearth.state.v1');
  const addOutboxIdx = localStorage.setOrder.indexOf('hearth.outbox.v1');
  assert.ok(addOutboxIdx < addStateIdx,
    `addMeasure: outbox (idx ${addOutboxIdx}) must be written before state (idx ${addStateIdx})`);

  localStorage.setOrder = [];
  removeMeasure('m-test');
  const rmStateIdx = localStorage.setOrder.indexOf('hearth.state.v1');
  const rmOutboxIdx = localStorage.setOrder.indexOf('hearth.outbox.v1');
  assert.ok(rmOutboxIdx < rmStateIdx,
    `removeMeasure: outbox (idx ${rmOutboxIdx}) must be written before state (idx ${rmStateIdx})`);
});

test('crash between the two setItem calls now loses the state, not the outbox op (recoverable on next pull)', () => {
  // A localStorage proxy that drops the second setItem call, simulating a
  // process kill that lands between the outbox write and the state write.
  const real = new MemoryStorage();
  let calls = 0;
  globalThis.localStorage = {
    getItem: (k) => real.getItem(k),
    setItem: (k, v) => {
      calls += 1;
      if (calls === 2) return; // crash: drop the second write
      real.setItem(k, v);
    },
    removeItem: (k) => real.removeItem(k),
  };
  try {
    addEntry({ type: 'bottle', start: '2026-01-01T10:00:00Z', amount: 120 });
  } catch (e) { /* expected if the dropped call would have thrown */ }

  // First write (outbox) survived; second (state) was dropped.
  assert.equal(outboxOps().length, 1, 'outbox op is durable across the crash');
  assert.equal(outboxOps()[0].method, 'PUT', 'op is a PUT so the next drain will upload it');
  assert.ok(outboxOps()[0].url.startsWith('/api/entries/'), 'op targets the entries endpoint');
  assert.equal(real.store['hearth.state.v1'], undefined,
    'state was lost — local view is stale, but the op is in the outbox and will be drained on next launch');
});

test('recovered entry is identical to the one the user logged (body round-trips through the outbox op)', () => {
  installStorage();
  const e = addEntry({ type: 'bottle', start: '2026-01-01T10:00:00Z', amount: 120, note: 'ouch' });
  const op = outboxOps().at(-1);
  assert.equal(op.method, 'PUT');
  assert.equal(op.url, '/api/entries/' + e.id);
  assert.equal(op.body.id, e.id);
  assert.equal(op.body.type, 'bottle');
  assert.equal(op.body.amount, 120);
  assert.equal(op.body.note, 'ouch');
  // Note: there is also a local copy in state() for normal-flow convenience.
  assert.ok(state().log.some((x) => x.id === e.id));
});
