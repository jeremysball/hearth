# Desync follow-up — stacked-PR continuation prompt

Paste the block below into a fresh Claude Code session to execute the remaining
desync fixes as a linear stack of PRs off #108. Root-cause analysis:
`docs/desync-root-cause.md`. Repro tests: `server/desync_repro_test.go`.

**Stack order rationale:** cursor/outbox hygiene (cause 4) lands first as the
safety net — it turns every residual wrong-family bug from silent permanent loss
into "one oversized resync," and the later fixes (1, 2) legitimately trigger the
family switches that would otherwise trip cause 4. Causes 2 and 3 are server-only
and independent; they're linearized here for clean sequential review but could be
pulled out as standalone PRs off `main`.

---

```
Continue the Hearth caregiver-desync work. The root cause is fully diagnosed in
docs/desync-root-cause.md (read it first) — four compounding family-transition
bugs. PR #108 (branch fix/concurrent-write-desync) already shipped the
concurrent-write fix + diagnosis + two partial reconcile-path fixes. Repro tests
live in server/desync_repro_test.go.

Your job: land the four remaining fixes as a LINEAR STACK of PRs, each branched
off the previous (base of the stack is fix/concurrent-write-desync / #108, which
must merge first or stay open as the base). Order is deliberate — the cursor
safety-net lands before the fixes that trigger legitimate family switches.

Start each PR only after the previous one's branch exists. For each: branch off
the previous branch, implement, add/flip tests, run `go test ./server` (+ the
relevant Playwright/unit suite if js changed), bump the version via
scripts/bump-version.sh ONLY if you touched cached assets (js/, index.html,
styles.css, sw.js), add a plain-language js/changelog.js entry for each
user-facing fix, commit (Conventional Commits), push, and open the PR with
--base set to the PREVIOUS branch in the stack. Shell tooling: rg/fd only.

STACK (each branches off the previous):

1. fix/desync-cursor-outbox-hygiene  (Cause 4, base off fix/concurrent-write-desync)
   - js/sync.js + js/app.js + js/store.js: make the sync cursor family-scoped —
     store {familyId, rev} instead of the bare hearth.lastsyncrev.v1; on any
     response/@/api/me showing a different family, reset the cursor to force a
     full resync and QUARANTINE (dead-letter) the outbox instead of draining it
     cross-family. Make store.js reset() clear hearth.lastsyncrev.v1,
     hearth.outbox.v1, and the dead-letter key.
   - Touches js → version bump + changelog entry ("Switching accounts no longer
     silently loses history").
   - Add a test proving a family switch forces full resync and doesn't drain the
     old outbox into the new family.

2. fix/desync-merge-rerev  (Cause 3, off branch 1)
   - server/resolve.go mergeFamilies: inside the tx, stamp every moved log_entries
     and growth row with a fresh rev from the TARGET family's counter (bump
     rev_counter by N and update rows in one statement, or bumpRev(to) per row),
     then hub.Broadcast(to) after commit. Restores ADR 0003's per-family rev
     invariant so merged history reaches partners' incremental pulls.
   - Flip TestMergeFamiliesMovesRowsBelowPartnersCursor to assert the partner's
     incremental pull now DELIVERS the moved rows and serverRev advances.
   - Server-only, but user-visible → changelog entry + version bump (changelog.js
     is a cached asset).

3. fix/desync-identity-cleanup  (Cause 2 remainder, off branch 2)
   - #108 already relinks on the live-session path. Now handle removal: when
     handleRemoveCaregiver stamps removed_at (server/caregivers.go), retarget or
     delete the dangling identities row so future sign-in never dead-ends on
     "removed". Keep the no-session "removed" answer recoverable by a fresh invite.
   - Server-only, user-visible → changelog entry + version bump.

4. fix/desync-oauth-family-split  (Cause 1 end-to-end, off branch 3)
   - The biggest one; #108 has the server-side mismatch guard but it's inert.
     Client: return the family id from /api/sync or /api/me, store it in _state,
     and have beginSignIn (js/account.js) append ?device_family=<id>. Server: keep
     the draft mismatch refusal. UI: give auth=mismatch a real screen ("this
     account belongs to a different family than this device's data") offering
     re-invite or explicit switch-and-wipe. Consider auto-linking the identity to
     the invited caregiver at join time to kill the stale-identity precondition.
   - Flip TestOAuthRestoreAfterSessionLossSilentlySplitsFamilies to assert the
     hint path now refuses with mismatch instead of splitting.
   - Touches js → version bump + changelog entry ("Signing in after losing your
     session no longer silently moves your device to the wrong family").

After each PR: run the tests, confirm green, and report the PR URL before
starting the next branch. Do not merge anything without the user's go-ahead.
```
