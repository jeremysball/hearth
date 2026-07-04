# Spec: fix the sync cursor-skip race with a monotonic revision counter

Status: proposed, not implemented. Follow-up to PR #47 (`fix(sync): stop dropping caregiver entries during concurrent syncs`).

## Problem

`handleSync` (`server/sync.go`) uses wall-clock timestamps as its cursor:

1. `resp.ServerTime = nowISO()` is captured at the start of the request.
2. Every table (`babies`, `settings`, `caregivers`, `log_entries`, `growth_entries`) is queried with `WHERE family_id = ? AND updated_at > ?since`.
3. The client stores `resp.ServerTime` as `lastSync` and sends it back as `since` on the next poll.

Every write path (`handleUpsertEntry`, `handleDeleteEntry`, `handleUpsertGrowth`, `handleDeleteGrowth`, `handlePatchBaby`, `handlePatchSettings`, caregiver mutations in `caregivers.go`) computes its own `now := nowISO()` *before* its `db.Exec` commits.

Under SQLite WAL mode, two independent wall-clock reads (the writer's `now`, the reader's `ServerTime`) have no ordering relationship with the actual commit/snapshot order. If a writer's `now` (`T_A`) is earlier than a concurrent reader's `ServerTime` (`T_S`), but the writer's transaction commits **after** the reader's SELECT already pinned its snapshot, the row carries `updated_at = T_A < T_S` and is invisible to that SELECT. The client advances its cursor to `T_S` anyway. Every future poll filters on `updated_at > T_S`, and since `T_A < T_S`, the row is **permanently unreachable** — this is not a transient miss, it's a permanent loss until a full resync (`since=`) happens to be triggered some other way.

`server/sync_test.go::TestHandleSyncCursorSkipLosesEntrySimulatingWriteReadInterleave` documents this (seeds the post-race state and proves the entry never surfaces, including on a later poll).

This requires no client-side timing coincidence — just two near-simultaneous requests (one caregiver logging something while the other's device happens to be polling), which is normal two-caregiver usage, not an edge case.

## Why timestamps can't be patched incrementally

Any fix that keeps wall-clock timestamps as the cursor (widening the lower-bound window, adding a safety margin, re-querying rows within N seconds of the cursor) trades permanent loss for either duplicate delivery windows or a residual race at a smaller time constant — it does not close the race, it shrinks it. The only way to eliminate it is to make "have I seen everything up to cursor X" a true yes/no fact rather than a wall-clock heuristic.

## Chosen approach: per-family monotonic revision counter

Replace the timestamp cursor with an integer revision number, assigned so that a row's `rev` and the counter's new high-water mark commit **atomically in the same transaction**. This is the piece that provides the actual guarantee (see "Correctness argument" below) — not just switching from a `TEXT` timestamp to an `INTEGER` counter.

### Schema changes (`server/schema.sql`)

```sql
ALTER TABLE families ADD COLUMN rev_counter INTEGER NOT NULL DEFAULT 0;

ALTER TABLE babies         ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings       ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caregivers     ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_entries    ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE growth_entries ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_log_entries_family_rev    ON log_entries(family_id, rev);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_rev ON growth_entries(family_id, rev);
CREATE INDEX IF NOT EXISTS idx_caregivers_family_rev     ON caregivers(family_id, rev);
```

Follow the project's existing `ALTER TABLE ... ADD COLUMN` + `duplicate column name` guard pattern already used in `server/db.go` for `caregivers.updated_at` — no migration framework, additive and idempotent.

### Backfill

One-time backfill on startup (same file/pattern as the existing `caregivers.updated_at` backfill in `db.go`), per family:

```sql
UPDATE families SET rev_counter = (
  SELECT COUNT(*) FROM (
    SELECT id FROM babies WHERE family_id = families.id
    UNION ALL SELECT id FROM settings WHERE family_id = families.id
    UNION ALL SELECT id FROM caregivers WHERE family_id = families.id
    UNION ALL SELECT id FROM log_entries WHERE family_id = families.id
    UNION ALL SELECT id FROM growth_entries WHERE family_id = families.id
  )
) WHERE rev_counter = 0;
```

Then assign each existing row a distinct `rev` in `updated_at` order (a `ROW_NUMBER() OVER (PARTITION BY family_id ORDER BY updated_at)` per table, offset so ranges don't collide across tables — simplest: backfill each table with its own disjoint block, e.g. babies get 1..N, settings get N+1..M, etc., since absolute values don't matter, only that they're all `<= families.rev_counter` and internally ordered by `updated_at`). Existing clients doing their first post-upgrade sync will pass `since=""` (empty/legacy) and get a full resync regardless (see rollout below), so backfill correctness only needs to hold for *ordering going forward*, not for reproducing historical ordering exactly.

### Write path changes

Every write handler that currently does:

```go
now := nowISO()
db.Exec(`UPDATE ... SET ..., updated_at = ? WHERE ...`, ..., now)
```

changes to, within a single `*sql.Tx`:

```go
tx, err := db.Begin()
// ...
var rev int64
if err := tx.QueryRow(`UPDATE families SET rev_counter = rev_counter + 1 WHERE id = ? RETURNING rev_counter`, familyID).Scan(&rev); err != nil { ... }
_, err = tx.Exec(`UPDATE log_entries SET ..., updated_at = ?, rev = ? WHERE ...`, ..., now, rev)
// ...
tx.Commit()
```

(`now`/`updated_at` stays for display purposes and as a secondary sort key — it is no longer the sync cursor.)

Affected handlers: `handleUpsertEntry`, `handleDeleteEntry` (`entries.go`), `handleUpsertGrowth`, `handleDeleteGrowth` (`growth.go`), `handlePatchBaby`, `handlePatchSettings` (`family.go`), and the caregiver mutations in `caregivers.go` (`handlePatchCaregiverRole`, `handleRemoveCaregiver`, `handlePatchCurrentCaregiver` — whichever of these currently stamp `updated_at`).

`RETURNING` requires SQLite ≥ 3.35; confirm the vendored/imported driver supports it (check `go.mod` / `modernc.org/sqlite` or `mattn/go-sqlite3` version) before relying on it — fall back to `UPDATE` then `SELECT rev_counter` in the same transaction if not.

### Read path changes (`handleSync`)

Wrap the whole handler body in one read transaction (`db.Begin()` with `sql.TxOptions{ReadOnly: true}` if the driver supports it, or a plain deferred transaction) instead of five independent `db.Query`/`db.QueryRow` calls on `db` directly:

```go
tx, _ := db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
defer tx.Rollback()

var currentRev int64
tx.QueryRow(`SELECT rev_counter FROM families WHERE id = ?`, session.FamilyID).Scan(&currentRev)

// each existing query becomes: WHERE family_id = ? AND rev > ?since   (tx.Query, not db.Query)

resp.ServerRev = currentRev   // replaces resp.ServerTime as the cursor
```

`since` becomes an integer (`?since=42`) instead of an RFC3339 timestamp. `syncLowerBound`/`changedAfter` (timestamp-comparison helpers) are deleted; the SQL `rev > ?` comparison does the filtering directly — no lexical/precision-truncation fallback needed, since integers compare exactly.

### Client changes (`js/sync.js`, `js/app.js`)

- `getLastSync`/`setLastSync` → `getLastSyncRev`/`setLastSyncRev`, storing an integer (as a string) under a new key (e.g. `hearth.lastsyncrev.v1` — new key, not a reinterpretation of `hearth.lastsync.v1`, so an old timestamp string left over from a pre-upgrade client is never misread as an integer).
- `js/app.js`'s `syncOnce`: `fetch('/api/sync?since=' + encodeURIComponent(getLastSync()))` → `...?since=' + getLastSyncRev()`, and `setLastSync(data.serverTime)` → `setLastSyncRev(data.serverRev)`.
- `mergeById` (id-keyed upsert/tombstone merge) is unaffected — it doesn't look at the cursor at all.

### Rollout / backward compatibility

Clients update via the service-worker version bump, but there's a window where an old client (cached, not yet reloaded) could still send the old `since=<ISO timestamp>` query param against the new server. Two options, pick one before implementing:

1. **Simplest, recommended:** `handleSync` treats a non-numeric `since` (fails to parse as an integer) as `since=0`, i.e. a forced full resync. `mergeById` is idempotent and keyed by id, so a full resync is just wasted bandwidth for one poll, not a correctness problem. No dual-mode code path to maintain.
2. Dual-mode: detect timestamp-shaped `since` and run the old lexical-comparison path. More code, no real benefit over (1) given Hearth's small per-family data volume — reject unless a specific reason to avoid one extra full resync per client comes up during review.

Go with (1).

## Correctness argument

The property that closes the race: **a row's `rev` and the family's `rev_counter` high-water mark are written in the same transaction, so they become visible to any concurrent reader atomically together — never partially.**

For any read transaction `R` with snapshot start time `t_R`:
- Every write transaction `W` that committed before `t_R` has both its row's `rev` *and* its contribution to `rev_counter` fully visible in `R`'s snapshot.
- Every write transaction `W` that commits after `t_R` has neither visible.
- There is no write transaction that could be "half-visible" (`rev_counter` bumped but row not yet visible, or vice versa), because SQLite transactions commit atomically and `R` reads both facts from one snapshot.

So if `R` reads `rev_counter = V` and returns `V` as the next cursor, every row with `rev <= V` that exists at all is guaranteed visible in `R`'s own row-selecting queries (same snapshot) — and the next poll's `WHERE rev > V` picks up exactly the complement, with no gap. This is a structural guarantee, not a probabilistic one — it holds regardless of write frequency, poll frequency, or clock skew, which is what makes it "most robust" versus a timestamp-based mitigation.

## Test plan

1. Keep and adapt `TestHandleSyncCursorSkipLosesEntrySimulatingWriteReadInterleave` as a **now-passing** guard: assert the previously-lost entry *is* reachable once `rev`-based cursors are in place (invert its current assertions, or replace it with a rev-based equivalent — do not just delete it, since it's the regression's provenance).
2. New deterministic test: seed two rows via two separate transactions with interleaved commit order vs. `rev` assignment order (i.e. directly construct the "reader's snapshot starts between two commits" scenario) and assert no row is ever skipped across a sequence of polls.
3. Re-run (or write fresh) the concurrent WAL stress test the original investigation used (`cursor_race_stress_test.go`, since deleted) — several writer goroutines racing several reader goroutines against a real file-backed SQLite DB — and confirm zero misses over many iterations, replacing the previous run's 952-miss result.
4. Full existing suite (`node --test js/*.test.js`, `go test ./server`, `CHROMIUM=/usr/bin/chromium npm test`) must stay green.

## Out of scope for this spec

- Changing `log_entries`/`growth_entries`/etc.'s `updated_at` semantics for anything other than sync filtering (e.g. any UI that displays "last edited" time keeps using `updated_at` as-is).
- SSE (`server/sse.go`) push delivery — unaffected; it's an optimization on top of polling, not the source of the correctness guarantee, and needs no changes.
