// sync.js — offline outbox queue + server sync merge logic (no DOM dependency, unit-testable).
const OUTBOX_KEY = 'hearth.outbox.v1';
const LAST_SYNC_KEY = 'hearth.lastsync.v1';

export function loadOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; }
}
export function saveOutbox(ops) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
}
export function enqueue(op) {
  const ops = loadOutbox();
  ops.push(op);
  saveOutbox(ops);
}

export function getLastSync() { return localStorage.getItem(LAST_SYNC_KEY) || ''; }
export function setLastSync(ts) { localStorage.setItem(LAST_SYNC_KEY, ts); }

// Drains the outbox to the server in order, stopping at the first failure so
// nothing is lost or reordered. Safe to call repeatedly (e.g. on a timer) —
// it's a no-op once the queue is empty.
export async function drainOutbox(fetchImpl) {
  let ops = loadOutbox();
  while (ops.length) {
    const op = ops[0];
    try {
      const res = await fetchImpl(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body ? JSON.stringify(op.body) : undefined,
        credentials: 'include'
      });
      if (!res.ok) throw new Error('sync request failed: ' + res.status);
    } catch (e) {
      return false; // leave remaining ops queued; caller retries later
    }
    ops = ops.slice(1);
    saveOutbox(ops);
  }
  return true;
}

// Merges a list of changed/tombstoned rows from the server into a local
// array, keyed by id. A row with `deletedAt` removes its local counterpart;
// any other row is an upsert (new or replacing the existing one).
export function mergeById(localList, incoming) {
  const byId = new Map(localList.map((x) => [x.id, x]));
  for (const row of incoming) {
    if (row.deletedAt) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return [...byId.values()];
}
