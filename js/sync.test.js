import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

const { loadOutbox, saveOutbox, enqueue, mergeById, drainOutbox, getLastSyncRev, setLastSyncRev, syncChangeCount } = await import('./sync.js');

test('enqueue appends an op and loadOutbox reads it back', () => {
  saveOutbox([]);
  enqueue({ url: '/api/entries/e1', method: 'PUT', body: { id: 'e1' } });
  const ops = loadOutbox();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].url, '/api/entries/e1');
});

test('loadOutbox returns an empty array when nothing is stored', () => {
  localStorage.removeItem('hearth.outbox.v1');
  assert.deepEqual(loadOutbox(), []);
});

test('mergeById applies an upsert', () => {
  const result = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }]);
  assert.deepEqual(result, [{ id: 'a', v: 2 }]);
});

test('mergeById applies a tombstone delete', () => {
  const result = mergeById([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], [{ id: 'a', deletedAt: '2026-01-01' }]);
  assert.deepEqual(result, [{ id: 'b', v: 1 }]);
});

test('mergeById adds a brand-new row not previously known locally', () => {
  const result = mergeById([{ id: 'a', v: 1 }], [{ id: 'b', v: 1 }]);
  assert.deepEqual(result.map((r) => r.id).sort(), ['a', 'b']);
});

test('syncChangeCount counts server entries and growth rows', () => {
  const count = syncChangeCount({ entries: [{ id: 'e1' }], growth: [{ id: 'g1' }] });
  assert.equal(count, 2);
});

test('drainOutbox stops and keeps the queue on network failure', async () => {
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  const fakeFetch = async () => { throw new Error('offline'); };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
});

test('drainOutbox empties the queue on success, in order', async () => {
  saveOutbox([
    { url: '/api/entries/x', method: 'PUT', body: { id: 'x' } },
    { url: '/api/entries/y', method: 'PUT', body: { id: 'y' } },
  ]);
  const calledUrls = [];
  const fakeFetch = async (url) => { calledUrls.push(url); return { ok: true, status: 204 }; };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, true);
  assert.equal(loadOutbox().length, 0);
  assert.deepEqual(calledUrls, ['/api/entries/x', '/api/entries/y']);
});

test('drainOutbox stops at the first failure and leaves remaining ops queued', async () => {
  saveOutbox([
    { url: '/api/entries/x', method: 'PUT', body: { id: 'x' } },
    { url: '/api/entries/y', method: 'PUT', body: { id: 'y' } },
  ]);
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 204 };
    throw new Error('offline mid-drain');
  };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
  assert.equal(loadOutbox()[0].url, '/api/entries/y');
});

test('drainOutbox does not lose an op enqueued while a slow send is in flight', async () => {
  saveOutbox([{ url: '/api/entries/A', method: 'PUT', body: { id: 'A' } }]);
  const sent = [];
  const fakeFetch = async (url) => {
    sent.push(url);
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, status: 204 };
  };

  const drainPromise = drainOutbox(fakeFetch);
  setTimeout(() => enqueue({ url: '/api/entries/B', method: 'PUT', body: { id: 'B' } }), 5);
  await drainPromise;

  assert.deepEqual(sent, ['/api/entries/A', '/api/entries/B']);
  assert.equal(loadOutbox().length, 0);
});

test('drainOutbox drops a permanently-rejected op (4xx) instead of jamming the queue forever', async () => {
  saveOutbox([
    { url: '/api/entries/bad', method: 'PUT', body: { id: 'bad' } },
    { url: '/api/entries/y', method: 'PUT', body: { id: 'y' } },
  ]);
  const calledUrls = [];
  const fakeFetch = async (url) => {
    calledUrls.push(url);
    if (url === '/api/entries/bad') return { ok: false, status: 400 };
    return { ok: true, status: 204 };
  };
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, true);
  assert.equal(loadOutbox().length, 0);
  assert.deepEqual(calledUrls, ['/api/entries/bad', '/api/entries/y']);
});

test('drainOutbox keeps retrying on 429 (rate limit) rather than dropping the op', async () => {
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  const fakeFetch = async () => ({ ok: false, status: 429 });
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
});

test('getLastSyncRev defaults to empty string, setLastSyncRev round-trips', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  assert.equal(getLastSyncRev(), '');
  setLastSyncRev(42);
  assert.equal(getLastSyncRev(), '42');
});
