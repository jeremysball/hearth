# Caregiver desync: root cause report (2026-07-07)

## The root cause

Hearth's sync contract is per-family (a per-family rev cursor, an identity bound to one family's caregiver), but device state (sync cursor, outbox, identity link, session, local data) silently survives family-membership transitions. Every transition path (session loss + OAuth restore, remove + re-invite, conflict merge/switch, device reset) violates at least one invariant, and each violation produces silent, permanent, often bidirectional desync. The concurrent-write race fixed in d23577c was real but marginal; the causes below are what users hit.

### Causes ranked by likelihood of being what real users hit

| # | Cause | Status | Proof |
|---|-------|--------|-------|
| 1 | OAuth restore after session loss silently switches the device into the identity's stale solo family | **LIVE** (server draft fix in tree is inert: client never sends the hint) | `TestOAuthRestoreAfterSessionLossSilentlySplitsFamilies` |
| 2 | Remove + re-invite leaves the Google identity bound to the removed caregiver; sign-in answers "removed" forever | Real; draft fix in tree covers the live-session path, uncommitted | `TestInviteRejoinIdentityAfterRemoveAndReinvite` |
| 3 | "Merge into my account" moves rows without re-revving them into the target family's counter; partners can never pull them | **LIVE**, no fix drafted | `TestMergeFamiliesMovesRowsBelowPartnersCursor` |
| 4 | The sync cursor and outbox are global per device, never reset on family switch or app reset | **LIVE**, no fix drafted | Code trace (below) |
| 5 | Concurrent-write loss (SQLITE_BUSY on rev bump) | Fixed on this branch (d23577c) | `server/concurrent_write_test.go` |

Causes 1–4 compound: #2 poisons the recovery path, which pushes the user into #1's restore path; any switch triggered by #1 or by conflict resolution then also trips #4.

---

## Cause 1: silent family split on OAuth restore (LIVE)

**Code path.** `server/oauth.go` `handleAuthCallback` → `reconcile()` (`server/reconcile.go`). At commit d23577c the identity-exists branch reads:

```go
// Identity exists → family B (familyID).
if cur == nil || cur.FamilyID == familyID {
    return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
}
```

**Sequence.**
1. She taps "Continue with Google" once with no session cookie (fresh browser, pre-invite): `reconcile` returns `signedup` and creates solo family famB with her identity bound to it (`reconcile.go`, sign-up branch).
2. She joins her partner's famA via invite. `handleJoinInvite` (`server/invites.go:44`) needs no auth, creates a new caregiver, and `setSessionCookie` overwrites her cookie. Her identity row still points at famB. Nothing links identities on join.
3. Her famA session dies (sessions never expire, `server/auth.go:15`, so this means: admin removal, a DB restore losing the `sessions` table, or cookie eviction). Every sync now 401s **silently**: `js/app.js:854` logs `pull failed` and returns, `js/sync.js` keeps 401'd ops queued by design. No UI surfaces it.
4. She taps "Continue with Google" to fix it. `cur == nil`, identity → famB, so `reconcile` returns `restored` into famB. New session cookie for famB.
5. Her device still displays famA's data locally and looks normal. Every write (including the whole 401-retained outbox) drains into famB; every pull returns famB. His device stays in famA. Zero errors either side. Permanent and bidirectional.

**Why it matches the incident.** The deleted logs showed a 401 storm followed by recovery-by-sign-in; this is the only path where sign-in "succeeds" yet lands the device in the wrong family.

**Working-tree draft fix is incomplete.** The uncommitted `reconcile.go`/`oauth.go` changes add a `device_family` hint carried through the OAuth redirect and return `Kind:"mismatch"` when the hint names a different family that has data. But the committed client never sends it:

```js
// js/account.js:31
export function beginSignIn(provider) {
  window.location.href = '/api/auth/' + provider;   // no ?device_family=...
}
```

So `deviceFamily` is always `""` and the guard never fires. The repro test asserts both: `""` still restores into famB; `"famA"` yields `mismatch`. **Ship the server fix alone and the bug remains 100% live.** (The client also doesn't currently store its family id anywhere; `/api/sync` doesn't return it.)

**Proof.** `server/desync_repro_test.go` `TestOAuthRestoreAfterSessionLossSilentlySplitsFamilies`: reconcile restores into famB, a real `handleUpsertEntry` write lands in famB, neither family's pull sees the other's entry.

## Cause 2: identity poisoned by remove + re-invite (real; draft-fixed in tree, uncommitted)

**Code path.** Committed `server/reconcile.go` (d23577c):

```go
if removedAt != "" {
    // ... comment ...
    return ReconcileResult{Kind: "removed"}, nil
}
```

**Sequence.** She is in famA with Google linked → admin removes her (`handleRemoveCaregiver`, `server/caregivers.go:125`, stamps `removed_at`, deletes her sessions) → admin re-invites, she joins as a brand-new caregiver (`handleJoinInvite` creates a fresh caregiver id; nothing touches `identities`). Her identity row still points at the removed caregiver, so every future Google sign-in returns `removed` ("You were removed from that family", `js/account.js:62`). While her invite session lives she syncs fine; the moment that session is lost, the only recovery path on the provisioned screen is permanently dead, and re-inviting again does not clear it (each join creates yet another caregiver, the identity stays poisoned).

**Verdict on severity.** Not itself a silent desync (the user sees a message), but it permanently disables recovery and is the "can't invite her back" half of the incident. The working-tree draft relinks the identity to the live caregiver when a live session exists (`Kind:"linked"`); with no live session it still answers `removed`, which is a recoverable dead end (a fresh invite works).

**Proof.** `TestInviteRejoinIdentityAfterRemoveAndReinvite` (asserts the tree's relink; the comment documents committed behavior, which the pre-draft version of this test proved directly).

## Cause 3: mergeFamilies moves rows the partner can never pull (LIVE)

**Code path.** `server/resolve.go:9`:

```go
if _, err := tx.Exec(`
    INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, deleted_at)
    SELECT id, ?, type, start, payload_json, created_by, updated_at, deleted_at
    FROM log_entries WHERE family_id = ?
    ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id`, to, from); err != nil {
```

Every source row PK-conflicts with itself, so each becomes `UPDATE ... SET family_id` only: the row **keeps the rev it earned from the source family's counter**. No `bumpRev(to)`, no restamp, no `hub.Broadcast`. This violates ADR 0003's invariant ("each write bumps rev_counter and stamps the row's rev from it in one transaction", per-family).

**Sequence.** Partner's device in target family famT holds cursor = famT `rev_counter` (say 5). She resolves an OAuth conflict with "Merge into my account": her solo family's rows (revs 1..3 from famS's counter) move into famT. Partner's next pull runs `WHERE rev > 5` (`server/sync.go:100`): the moved rows never appear, `serverRev` is still 5, the cursor only ratchets upward, and the rows are never rewritten. Her own device has the data locally, so the merge looks successful; the partner silently and permanently lacks the merged history. Growth entries identically.

**Proof.** `TestMergeFamiliesMovesRowsBelowPartnersCursor`: real handlers seed famT to rev 5, merge famS (revs 1..3), partner's incremental pull at cursor 5 returns none of them and `serverRev` stays 5, while a full `since=-1` pull returns all three (data exists; only the incremental path loses it).

## Cause 4: sync cursor and outbox are global per device, never reset (LIVE)

**Code trace** (this one is three one-liners, no test needed):

- The cursor is one un-namespaced key: `js/sync.js:4` `const LAST_SYNC_REV_KEY = 'hearth.lastsyncrev.v1';` with no family id in key or value.
- It is written in exactly one place, `js/app.js:858` `setLastSyncRev(data.serverRev)`, and read for every pull (`app.js:853`). Nothing anywhere calls `setLastSyncRev('')`.
- Family switches that keep localStorage: OAuth `restored` into a different family (cause 1), and conflict resolution, `js/account.js:93`, which keeps all local state: `state().setup = true; save();`.
- App reset does not clear it either: `js/store.js:92` `export function reset() { _state = DEFAULT(); save(); }` leaves `hearth.lastsyncrev.v1`, `hearth.outbox.v1`, and the dead-letter key intact.

**Consequences.** After any family switch the device pulls famB with famA's watermark. Every famB row with `rev <= oldCursor` is skipped; the first pull then writes famB's (lower) `serverRev` as the new cursor, but the skipped rows keep their original revs and are never delivered. Concretely: switch from a long-lived famA (cursor 500) into famB (rev_counter 3) and the device never downloads famB's entire pre-existing history; switch the other way and the oldest famB rows below 500 are lost to that device. Additionally, `mergeById` happily merges famB rows into still-present famA local data (mixed-family local state), and a stale outbox drains old-family entry payloads into the new family under the new session (cross-family data leakage). The reset() variant means "Reset everything" then re-join is enough to poison a fresh-looking device.

## Cause 5: concurrent-write loss (FIXED)

d23577c serialized the pool (`db.SetMaxOpenConns(1)`, `server/db.go`) and decoupled the outbox drain from the pull (`js/app.js` `syncOnce`). With one connection, `bumpRev`'s read-modify-write upgrade can no longer hit SQLITE_BUSY mid-transaction. Guarded by `server/concurrent_write_test.go`. I verified the surrounding cursor design is sound: `handleSync` reads `rev_counter` and all `rev > since` rows in one read transaction (`server/sync.go:42-49`), matching ADR 0003's snapshot argument, and `mergeById` (`js/sync.js:116`) only deletes on explicit tombstones, so a pull can never drop a local unpushed entry. SSE (`server/sse.go`) is family-scoped and lossy-by-design with a 15s poll backstop; not a desync source.

---

## Verdict on the two candidate scenarios

- **Scenario 1 (identity poison): REAL, but secondary.** It is a loud dead end, not a silent desync; its damage is disabling the only recovery path and creating duplicate caregivers. The tree's draft relink is the right direction for the live-session case.
- **Scenario 2 (silent family split): REAL and PRIMARY.** It is the only path that matches "permanent, bidirectional, no visible error" plus the logged 401 storm. It is still live end-to-end because the draft server fix depends on a `device_family` hint the client never sends.
- **Neither is the whole story.** Causes 3 and 4 are independent, still-live desync sources that no draft addresses. Cause 3 in particular produces the same user-visible symptom ("my partner doesn't see my entries") through a path nobody had suspected, and cause 4 turns *any* family switch, including the ones the fixes for 1 and 2 will legitimately perform, into silent history loss.

## Recommended fix directions (not implemented)

1. **Family split:** finish the draft end-to-end. Client: persist the family id (return it from `/api/sync` or `/api/me`, store in `_state`), and have `beginSignIn` append `?device_family=<id>`. Server: keep the draft's mismatch refusal. UI: give `auth=mismatch` a real screen ("this account belongs to a different family than this device's data") offering re-invite or explicit switch-and-wipe. Consider also auto-linking the identity to the invited caregiver at join time when the joining browser already carries a known identity, which removes the famB stale-identity precondition itself.

2. **Identity poison:** commit the draft relink (live-session path). For the no-session path, keep "removed" but make join do the repair: when a re-invited user signs in later, the relink covers it, so the remaining gap is only session-loss-before-sign-in, recoverable by a fresh invite. Also consider deleting or retargeting `identities` rows when their caregiver is removed, so state never dangles.

3. **Merge re-rev:** inside `mergeFamilies`'s transaction, stamp every moved row with a fresh rev from the **target** family's counter (one `bumpRev(to)` per row, or reserve a contiguous block by bumping `rev_counter` by N and updating rows in one statement), then `hub.Broadcast(to)` after commit. This restores ADR 0003's invariant and makes merged history flow to partners' incremental pulls immediately.

4. **Cursor/outbox hygiene:** treat the cursor and outbox as family-scoped state. Minimal fix: have the client remember which family its cursor belongs to (store `{familyId, rev}`), and on any response or `/api/me` showing a different family, reset the cursor to force a full resync and quarantine (dead-letter) the outbox rather than draining it cross-family. Also make `reset()` clear `hearth.outbox.v1`, `hearth.lastsyncrev.v1`, and the dead-letter key. This one guard converts every residual wrong-family bug from "silent permanent loss" into "one oversized resync".

## Repro/test inventory

- `server/desync_repro_test.go`: all three scenarios above (updated for the tree's 6-arg `reconcile`; scenario 3 added).
- `server/reconcile_test.go`: call sites updated to pass `deviceFamily: ""`; all pre-existing assertions unchanged and passing.
- `go test ./server`: **ok** (11.7s), full suite, on the working tree (which includes the uncommitted draft fixes to `reconcile.go`/`oauth.go`).
