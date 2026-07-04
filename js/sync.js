// sync.js: offline outbox queue + server sync merge logic (no DOM dependency, unit-testable).
import { log } from './log.js';
const OUTBOX_KEY = 'hearth.outbox.v1';
const LAST_SYNC_REV_KEY = 'hearth.lastsyncrev.v1';

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

// The sync cursor is the server's per-family revision counter, not a
// timestamp — see docs/superpowers/specs/2026-07-04-sync-cursor-revision-counter.md
// for why timestamps can silently and permanently lose entries under
// concurrent writes. A missing or non-numeric value here (a fresh client, or
// a pre-upgrade client with a leftover ISO-timestamp string) is sent as-is;
// the server treats anything it can't parse as an integer as "since the
// beginning" and returns a full resync.
export function getLastSyncRev() { return localStorage.getItem(LAST_SYNC_REV_KEY) || ''; }
export function setLastSyncRev(rev) { localStorage.setItem(LAST_SYNC_REV_KEY, String(rev)); }

// Drains the outbox to the server in order, stopping at the first failure so
// nothing is lost or reordered. Safe to call repeatedly (e.g. on a timer):
// it's a no-op once the queue is empty. Concurrent calls (e.g. a timer tick
// firing while a log action's own trigger is still mid-request) share a
// single in-flight run rather than each keeping their own stale copy of the
// queue — otherwise whichever call finishes last overwrites storage with its
// own outdated snapshot, silently dropping any op enqueued in the meantime.
let inFlight = null;
export function drainOutbox(fetchImpl) {
  if (inFlight) return inFlight;
  inFlight = drain(fetchImpl).finally(() => { inFlight = null; });
  return inFlight;
}

async function drain(fetchImpl) {
  let ops = loadOutbox();
  if (!ops.length) return true;
  log.info('outbox', `draining ${ops.length} op${ops.length !== 1 ? 's' : ''}`);
  while (ops.length) {
    const op = ops[0];
    log.info('outbox', `→ ${op.method} ${op.url}`);
    try {
      const res = await fetchImpl(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body ? JSON.stringify(op.body) : undefined,
        credentials: 'include'
      });
      if (!res.ok) throw new Error('sync request failed: ' + res.status);
    } catch (e) {
      log.warn('outbox', `failed (${ops.length} remaining)`, e.message);
      return false;
    }
    ops = loadOutbox().slice(1);
    saveOutbox(ops);
  }
  log.info('outbox', 'drained');
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

export function syncChangeCount(resp) {
  return (resp.entries?.length || 0) + (resp.growth?.length || 0);
}
