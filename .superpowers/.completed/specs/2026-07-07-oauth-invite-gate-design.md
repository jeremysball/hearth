# OAuth invite gate + device_family completion — design

## Problem

Hearth is single-tenant per deployment: `handleCreateFamily` (`server/family.go`)
refuses to create a second family once one exists (`409 a family already exists
on this instance`). `reconcile()` (`server/reconcile.go`) has no equivalent
guard on its OAuth "signedup" branch. A stranger who clicks "Continue with
Google" on an already-provisioned instance — `provisionedView()`
(`js/onboarding.js`) already reads "Sign in if you're a caregiver, or ask for
an invite link" — silently gets a brand-new private family in the same
SQLite database. No error, no gate, no way for an admin to notice.

Separately, Cause 1 from `docs/desync-root-cause.md` is half-fixed: the
server already carries a `device_family` cookie through the OAuth redirect
and refuses to silently restore into a different family when the hint and
the identity's family disagree over real data (`reconcile()`'s `mismatch`
branch), but the client never sends the hint and never shows a screen for
`auth=mismatch`.

This PR closes both gaps, since they share the same `reconcile()` /
`handleAuthCallback` surface.

## reconcile() changes

`server/reconcile.go`: add an `inviteToken string` parameter, threaded from
`handleAuthCallback` the same way `deviceFamily` already is.

**No identity found, no live session** (today: always creates a fresh family
— "signedup"):
- Instance has zero families (`SELECT EXISTS(SELECT 1 FROM families)` is
  false): unchanged. This is first-run bootstrap via Google, parallel to the
  manual onboarding form.
- Instance already has its one family:
  - Valid invite token: create a caregiver in the invite's family (same
    shape as `handleJoinInvite`'s insert) + an `identities` row, mark the
    invite used, `Kind: "linked"`.
  - No invite token, or an invalid/expired/used one: new `Kind: "denied"`.
    No family, caregiver, or identity is created.

**Identity found, caregiver removed, no live session** (today: `Kind:
"removed"`, dead end):
- Valid invite token: reactivate the same caregiver row (clear
  `removed_at`, bump `updated_at`), mark the invite used, `Kind:
  "restored"`. No new caregiver row — single-tenancy guarantees the
  invite's family always matches this caregiver's `family_id`, so there is
  no family-placement ambiguity to resolve.
- No/invalid invite token: unchanged, `Kind: "removed"`.

**Identity found, live (non-removed) caregiver**: unaffected by invite
tokens — "you're on the list, sign right back in" regardless. This
includes the existing `device_family` mismatch-detection branch (Cause 1),
which stays exactly as implemented.

An invalid, expired, or already-used invite token is treated identically to
no token at all — the sign-in resolves to `denied` (or `removed`), never to
an `auth=error` page. A malformed invite is a "you need a real invite"
story, not a system failure.

## Shared invite validation

`server/invites.go`: extract

```go
func consumeInvite(tx *sql.Tx, token string) (familyID, matchedHash string, err error)
```

performing the same lookup + expiry/used checks `handleJoinInvite` already
does (`lookupByToken` against `invites`, checking `used_at` and
`expires_at`), returning a sentinel error for "not found or no longer
usable" that callers collapse into their deny/removed path. The caller is
responsible for marking it used (`UPDATE invites SET used_at = ? WHERE
token_hash = ?`) using the returned `matchedHash`, inside the same
transaction as the caregiver create/reactivate, so a crash mid-join can't
leave an invite consumed with no caregiver to show for it, or vice versa.

`handleJoinInvite` is refactored to call `consumeInvite` too (wrapped in a
transaction it doesn't currently use), so there is exactly one invite
validation path for both the manual join form and the new OAuth paths.

## OAuth transport

`server/oauth.go`: mirror the existing `device_family` cookie exactly.

- `handleAuthBegin`: read `?invite=<token>` from the query string, validate
  it's hex/newID-shaped (reuse the same check `validDeviceFamily` already
  does — both values are `newID()` output), store it in a new
  `hearth_oauth_invite` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, same
  10-minute `MaxAge` as the state cookie).
- `handleAuthCallback`: read the cookie back, clear it, pass the token to
  `reconcile()`.

## Client — Cause 1 completion

- `js/account.js`: `beginSignIn(provider, inviteToken)` appends
  `?device_family=<id>` (from the family id already returned by
  `/api/sync`/`/api/me`) and, when present, `&invite=<inviteToken>` to the
  `/api/auth/<provider>` redirect.
- `js/app.js`: `handleAuthRedirect` gains an `auth === 'mismatch'` branch
  that opens a sheet (reusing the existing conflict-sheet pattern in
  `account.js`) offering two choices: get a new invite link from an admin,
  or switch to the account's family and wipe this device's local data.
  `auth === 'denied'` shows a toast: "This Hearth needs an invite link to
  sign in."

## Client — invite gate entry point

`js/join.js`: `joinView(token)` gets a "Continue with Google" button
alongside the existing name-based join form, calling
`beginSignIn('google', token)`. This is the entry point for a re-invited or
device-lost caregiver to join via OAuth without retyping a display name.

The generic sign-in buttons on `onboarding()` and `provisionedView()`
(`js/onboarding.js`) stay invite-less by design — no manually-pasted invite
code field. The invite link itself is the existing distribution mechanism;
adding a second one is unnecessary surface for a case the link already
covers.

## Testing

- Flip `TestOAuthRestoreAfterSessionLossSilentlySplitsFamilies`
  (`server/reconcile_test.go` or wherever it lives) to assert the
  `device_family` hint path now resolves to `mismatch`, not a split.
- New `reconcile()` test cases: signed-up-with-existing-family+no-invite
  (`denied`), signed-up-with-valid-invite (`linked`, lands in the invite's
  family), removed+valid-invite (`restored`, `removed_at` cleared on the
  same caregiver id), removed+no-invite (unchanged `removed`).
- `consumeInvite` unit tests: not-found, expired, already-used, valid.
- `go test ./server` for all of the above.
- `node --test js/sync.test.js js/store.test.js` (unaffected, run for
  regression safety).
- Playwright coverage for the new join-via-Google button and the mismatch
  sheet, added to whichever existing auth-flow spec covers `js/join.js` /
  `js/account.js` today.

## Out of scope

- Multi-tenant support (multiple families per instance). The reactivation
  path's "invite family always matches caregiver family" invariant relies
  on single-tenancy; revisit if that ever changes.
- Auto-linking a manual (non-OAuth) `/join/{token}` submission to an
  existing Google identity already known to the browser. The OAuth-native
  join button covers the real use case; adding this to the manual path too
  is unnecessary for now.
