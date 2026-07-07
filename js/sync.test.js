import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.store = {}; }
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
}
globalThis.localStorage = new MemoryStorage();

const { loadOutbox, saveOutbox, enqueue, mergeById, drainOutbox, getLastSyncRev, setLastSyncRev, getLastSyncFamilyId, applySyncFamily, clearSyncState, syncChangeCount, loadDeadLetters, dismissDeadLetter } = await import('./sync.js');

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

for (const status of [401, 403, 408, 429]) {
  test(`drainOutbox keeps retrying on ${status} rather than dropping the op`, async () => {
    saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
    const fakeFetch = async () => ({ ok: false, status });
    const ok = await drainOutbox(fakeFetch);
    assert.equal(ok, false);
    assert.equal(loadOutbox().length, 1);
    assert.equal(loadOutbox()[0].url, '/api/entries/x');
  });
}

test('drainOutbox keeps retrying on a 5xx server error rather than dropping the op', async () => {
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  const fakeFetch = async () => ({ ok: false, status: 503 });
  const ok = await drainOutbox(fakeFetch);
  assert.equal(ok, false);
  assert.equal(loadOutbox().length, 1);
});

test('drainOutbox records a dropped op as a dead letter instead of losing it silently', async () => {
  localStorage.removeItem('hearth.deadletter.v1');
  saveOutbox([{ url: '/api/entries/bad', method: 'PUT', body: { id: 'bad', type: 'feed' } }]);
  const fakeFetch = async () => ({ ok: false, status: 400 });
  await drainOutbox(fakeFetch);
  const letters = loadDeadLetters();
  assert.equal(letters.length, 1);
  assert.equal(letters[0].status, 400);
  assert.deepEqual(letters[0].op, { url: '/api/entries/bad', method: 'PUT', body: { id: 'bad', type: 'feed' } });
  assert.equal(typeof letters[0].id, 'string');
  assert.equal(typeof letters[0].droppedAt, 'string');
});

test('drainOutbox does not record a dead letter for a transient failure', async () => {
  localStorage.removeItem('hearth.deadletter.v1');
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  const fakeFetch = async () => ({ ok: false, status: 503 });
  await drainOutbox(fakeFetch);
  assert.equal(loadDeadLetters().length, 0);
});

test('dismissDeadLetter removes only the matching entry', async () => {
  localStorage.removeItem('hearth.deadletter.v1');
  saveOutbox([
    { url: '/api/entries/a', method: 'PUT', body: { id: 'a' } },
    { url: '/api/entries/b', method: 'PUT', body: { id: 'b' } },
  ]);
  const fakeFetch = async () => ({ ok: false, status: 400 });
  await drainOutbox(fakeFetch);
  const [first, second] = loadDeadLetters();
  assert.equal(loadDeadLetters().length, 2);
  dismissDeadLetter(first.id);
  const remaining = loadDeadLetters();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, second.id);
});

test('getLastSyncRev defaults to empty string, setLastSyncRev round-trips', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  assert.equal(getLastSyncRev(), '');
  setLastSyncRev(42);
  assert.equal(getLastSyncRev(), '42');
});

test('getLastSyncRev treats a pre-upgrade bare-string cursor as a valid rev', () => {
  localStorage.setItem('hearth.lastsyncrev.v1', '2026-01-01T00:00:00Z');
  assert.equal(getLastSyncRev(), '2026-01-01T00:00:00Z');
});

test('applySyncFamily records the family on first sync without resetting anything', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  setLastSyncRev(7);
  const switched = applySyncFamily('famA');
  assert.equal(switched, false);
  assert.equal(getLastSyncRev(), '7');
});

test('applySyncFamily is a no-op when the family is unchanged', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  applySyncFamily('famA');
  setLastSyncRev(99);
  const switched = applySyncFamily('famA');
  assert.equal(switched, false);
  assert.equal(getLastSyncRev(), '99');
});

test('applySyncFamily detects a family switch, resets the cursor, and quarantines the outbox instead of draining it cross-family', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  localStorage.removeItem('hearth.deadletter.v1');
  applySyncFamily('famA');
  setLastSyncRev(500);
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);

  const switched = applySyncFamily('famB');

  assert.equal(switched, true);
  assert.equal(getLastSyncRev(), '', 'cursor must reset to force a full resync');
  assert.equal(loadOutbox().length, 0, 'outbox must not drain into the new family');
  const letters = loadDeadLetters();
  assert.equal(letters.length, 1);
  assert.equal(letters[0].status, 'family-switch');
  assert.equal(letters[0].op.url, '/api/entries/x');
});

test('applySyncFamily with a falsy familyId is a no-op', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  applySyncFamily('famA');
  setLastSyncRev(12);
  const switched = applySyncFamily('');
  assert.equal(switched, false);
  assert.equal(getLastSyncFamilyId(), 'famA');
  assert.equal(getLastSyncRev(), '12');
});

test('getLastSyncFamilyId defaults to empty string and tracks applySyncFamily', () => {
  localStorage.removeItem('hearth.lastsyncrev.v1');
  assert.equal(getLastSyncFamilyId(), '');
  applySyncFamily('famA');
  assert.equal(getLastSyncFamilyId(), 'famA');
});

test('clearSyncState wipes the cursor, outbox, and dead letters', () => {
  applySyncFamily('famA');
  setLastSyncRev(10);
  saveOutbox([{ url: '/api/entries/x', method: 'PUT', body: { id: 'x' } }]);
  clearSyncState();
  assert.equal(getLastSyncRev(), '');
  assert.deepEqual(loadOutbox(), []);
  assert.deepEqual(loadDeadLetters(), []);
});
