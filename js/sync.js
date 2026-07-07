// sync.js: offline outbox queue + server sync merge logic (no DOM dependency, unit-testable).
import { log } from './log.js';
const OUTBOX_KEY = 'hearth.outbox.v1';
const LAST_SYNC_REV_KEY = 'hearth.lastsyncrev.v1';
const DEAD_LETTER_KEY = 'hearth.deadletter.v1';

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
// timestamp. See docs/adr/0003-sync-cursor-revision-counter.md for why
// timestamps silently and permanently lose entries under concurrent writes. A
// missing or non-numeric value here (a fresh client, or a pre-upgrade client
// with a leftover ISO-timestamp string) is sent as-is; the server treats
// anything it can't parse as an integer as "since the beginning" and returns a
// full resync.
//
// The cursor is stored alongside the family id it was earned under. A device
// that switches families (OAuth restore into a stale identity's family,
// conflict-resolution merge/switch, admin remove + re-invite) must not keep
// pulling with the old family's watermark — rows in the new family with
// rev <= that watermark would be silently skipped forever. applySyncFamily
// detects the switch and resets the cursor so the next pull is a full resync.
function loadCursor() {
  const raw = localStorage.getItem(LAST_SYNC_REV_KEY);
  if (!raw) return { familyId: '', rev: '' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { familyId: parsed.familyId || '', rev: parsed.rev != null ? String(parsed.rev) : '' };
    }
  } catch (e) { /* pre-upgrade client: raw was a bare rev/timestamp string, not JSON */ }
  return { familyId: '', rev: raw };
}
function saveCursor(familyId, rev) {
  localStorage.setItem(LAST_SYNC_REV_KEY, JSON.stringify({ familyId, rev: String(rev) }));
}

export function getLastSyncRev() { return loadCursor().rev; }
export function setLastSyncRev(rev) { saveCursor(loadCursor().familyId, rev); }

// Called with the familyId a sync response came back for. If the device's
// cursor already belongs to a different, non-empty family, this is a family
// switch: the outbox is quarantined (dead-lettered, not drained cross-family)
// and the cursor is reset so the caller re-pulls with since=-1. Returns true
// when a switch was detected.
export function applySyncFamily(familyId) {
  const cur = loadCursor();
  if (cur.familyId && familyId && cur.familyId !== familyId) {
    quarantineOutbox();
    saveCursor(familyId, '');
    return true;
  }
  if (!cur.familyId && familyId) saveCursor(familyId, cur.rev);
  return false;
}

// Clears all device-local sync state: outbox, cursor, and dead letters. Used
// by store.reset() so "reset everything" actually starts clean instead of
// leaving a stale cursor/outbox for the next family this device joins.
export function clearSyncState() {
  localStorage.removeItem(OUTBOX_KEY);
  localStorage.removeItem(LAST_SYNC_REV_KEY);
  localStorage.removeItem(DEAD_LETTER_KEY);
}

// Ops the server permanently rejected (see isPermanentFailure below) land
// here instead of vanishing, so a caregiver can see what didn't save and
// re-enter it rather than silently losing an entry they typed.
export function loadDeadLetters() {
  try { return JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || '[]'); } catch (e) { return []; }
}
function saveDeadLetters(items) {
  localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(items));
}
function pushDeadLetter(op, status) {
  const items = loadDeadLetters();
  items.push({ id: 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), op, status, droppedAt: new Date().toISOString() });
  saveDeadLetters(items);
}
export function dismissDeadLetter(id) {
  saveDeadLetters(loadDeadLetters().filter((x) => x.id !== id));
}

// A family switch means the queued ops were written under the old family's
// session; draining them now would push the old family's data into the new
// one. Quarantine instead of dropping so the caregiver can see and re-enter
// them, same as any other permanently-rejected op.
function quarantineOutbox() {
  const ops = loadOutbox();
  if (!ops.length) return;
  const items = loadDeadLetters();
  const droppedAt = new Date().toISOString();
  for (const op of ops) {
    items.push({ id: 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), op, status: 'family-switch', droppedAt });
  }
  saveDeadLetters(items);
  saveOutbox([]);
}

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

// A 4xx usually means the server rejected this exact request and will keep
// rejecting it forever (bad payload, stale/removed resource, etc.) — retrying
// unchanged never helps, so the op is dropped rather than blocking the queue.
// Three codes are exceptions, kept queued for retry instead:
// - 408 (timeout) and 429 (rate limit): the server is asking for a retry,
//   not passing verdict on the request.
// - 401/403 (auth): a verdict on the *session*, not the payload — dropping
//   here would silently lose an entry the user typed just because their
//   cookie expired or was revoked while offline. Keeping it queued means it
//   sends successfully once they're signed back in.
// Anything else (network failure, 5xx) is transient, so the op stays queued
// and drain stops to preserve order.
function isPermanentFailure(status) {
  if (status < 400 || status >= 500) return false;
  return status !== 401 && status !== 403 && status !== 408 && status !== 429;
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
      if (!res.ok) {
        if (isPermanentFailure(res.status)) {
          log.error('outbox', `dropping op the server will never accept (${res.status})`, op.method, op.url);
          pushDeadLetter(op, res.status);
          ops = loadOutbox().slice(1);
          saveOutbox(ops);
          continue;
        }
        throw new Error('sync request failed: ' + res.status);
      }
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
