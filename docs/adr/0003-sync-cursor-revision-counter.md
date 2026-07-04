# ADR 0003: Sync cursor is a per-family revision counter, not a timestamp

- **Status:** Accepted
- **Date:** 2026-07-04
- **Context:** ADR 0001 shipped `/api/sync` with a wall-clock cursor: each response returned `ServerTime = nowISO()`, the client stored it as `lastSync` and sent it back as `since`, and every table filtered on `updated_at > since`. Under SQLite WAL mode this permanently drops entries. This ADR replaces that cursor.

---

## Decision

Cursor on a per-family monotonic integer, not a timestamp.

- `families.rev_counter` is a high-water mark. Every table (`babies`, `settings`, `caregivers`, `log_entries`, `growth_entries`) carries a `rev` column.
- Each write bumps `rev_counter` and stamps the row's `rev` from it **in one transaction** (`UPDATE families SET rev_counter = rev_counter + 1 ... RETURNING rev_counter`, then the row write, same `*sql.Tx`).
- `handleSync` runs in one read transaction: it reads `rev_counter` into `resp.ServerRev` and selects every row `WHERE rev > since` from the same snapshot.
- The client stores `serverRev` under `hearth.lastsyncrev.v1` and sends it as `?since=<int>`. A non-numeric `since` (a stale pre-upgrade client) parses to `0`, forcing one full resync.

`updated_at` stays for display and as a secondary sort key. It no longer drives sync.

## Why the timestamp cursor lost data

Two wall-clock reads (a writer's `now`, a reader's `ServerTime`) have no ordering relationship with SQLite's commit order. A writer can stamp `updated_at = T_A` earlier than a concurrent reader's `ServerTime = T_S`, yet commit *after* that reader pinned its snapshot. The row (`T_A < T_S`) never appears in that read, the client advances its cursor to `T_S`, and every later poll filters it out. The entry is lost until an unrelated full resync happens to run. Two near-simultaneous requests trigger it, which is ordinary two-caregiver use.

Widening the lower bound, adding a safety margin, or re-querying recent rows shrinks the race window; it never closes it. Closing it requires making "have I seen everything up to cursor X" a yes/no fact rather than a clock heuristic.

## Correctness guarantee

A row's `rev` and the family's `rev_counter` bump commit in one transaction, so a concurrent reader sees both or neither, never half. For a read snapshot that returns `rev_counter = V`, every row with `rev <= V` that exists is visible in that same snapshot's selects, and the next poll's `WHERE rev > V` picks up exactly the complement. No gap, structural rather than probabilistic: it holds regardless of write frequency, poll frequency, or clock skew.

`server/sync_test.go` guards this: the test that once proved the entry was lost now asserts it survives.

## Consequences

- (+) Concurrent caregiver writes can no longer silently vanish.
- (+) Integer `rev > ?` compares exactly, so the old lexical-timestamp comparison helpers are gone.
- (−) Every write now opens a transaction to bump the counter. At Hearth's per-family volume this cost is invisible.
- Schema stays additive and idempotent (`ALTER TABLE ... ADD COLUMN` with the existing `duplicate column name` guard in `db.go`, plus a one-time `rev` backfill in `updated_at` order). No migration framework.

## Alternatives considered

- **Timestamp cursor with a safety margin.** Trades permanent loss for duplicate delivery or a smaller residual race. Rejected: it shrinks the window without closing it.
- **Dual-mode server that also parses legacy timestamp `since`.** Extra code for no gain over treating a non-numeric cursor as a full resync, since `mergeById` is idempotent. Rejected.
