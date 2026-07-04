# First-account gating — design

Status: Approved, ready for implementation plan.

## Problem

One Hearth instance is one family, one baby, permanently — it isn't multi-tenant. Today,
`POST /api/family` (`server/family.go:29-95`) is fully open and unauthenticated: anyone who hits
a fresh instance's root URL with no invite or launch token sees the full "Create Hearth" form
(`js/onboarding.js:10-48`) and can provision a brand-new family, even on an instance that already
has one. Nothing currently stops a second, unauthorized family from being created.

The onboarding screen already offers Google/Apple sign-in (`signInButtons()`,
`js/onboarding.js:45`) alongside "Create Hearth," so a returning caregiver on a new device can
already sign in without creating a family, and the existing invite/launch-token join flow
(`/join/{token}`, `/api/launch/{token}`) is unaffected by this change. The actual gap is narrower
than "gate all signups" — it's specifically closing off the create-family path once an instance
is already provisioned.

## Design

### Server: `/api/status` and a hard gate on `/api/family`

Add `GET /api/status` (unauthenticated) returning `{"provisioned": bool}`, computed as
`SELECT EXISTS(SELECT 1 FROM families)`.

`handleCreateFamily` (`server/family.go:29`) performs that same existence check inside its
existing transaction, immediately before the `INSERT INTO families` call. If a family already
exists, roll back and return `409 Conflict` with a small JSON error body. This is the
authoritative gate — the client-side check below is UX only. Running the check and the insert in
one transaction closes the race window where two fresh devices both boot and POST at nearly the
same instant: the first commit wins, the second sees the row and gets 409.

### Client: branch before rendering onboarding

In `js/app.js`'s `init()`, the branch that falls through to `onboarding()` when `!state().setup`
and there's no launch/join match (`app.js:727`) first calls `GET /api/status`.

- `provisioned: false` → render `onboarding()` as today.
- `provisioned: true` → render a new `provisionedView()` (in `js/onboarding.js`): same
  logo/branding shell as onboarding, no baby-name/theme/photo form, a one-line message ("This
  Hearth already has a family. Sign in if you're a caregiver, or ask for an invite link."), and
  `signInButtons()`.
- Status check fails (offline at boot) → fall back to showing `onboarding()` as today. The
  server-side 409 still protects against actually creating a duplicate family once the device is
  back online; a soft client gate can't be enforced while offline, so it fails open to the
  existing UX rather than blocking a legitimately fresh, offline instance.

### Handling the 409 on the optimistic local-first write

`onboardFinish()` (`js/onboarding.js:84-122`) is optimistic: it sets `state().setup = true`,
seeds local baby state (`seed()`), and navigates to the home screen before `POST /api/family`
resolves. This only changes for the rare case where the client's status check was stale, raced
with another device, or was skipped because the device was offline at boot and has since
reconnected:

If the `POST /api/family` response is `409`, roll back the optimistic write:
- `state().setup = false`
- clear the seeded baby/entries state
- re-render `provisionedView()`
- toast: "This Hearth was already set up on another device."

The common path (fresh instance, no race) never reaches this branch.

### Out of scope

- Gating `signInButtons()` on whether OAuth providers are actually configured
  (`Config.OAuthConfigured`, `server/config.go:57-59`) — the existing `accountSection()`
  (`js/account.js:21-30`) already shows sign-in buttons unconditionally regardless of configured
  providers; this design stays consistent with that established pattern rather than introducing
  new gating logic.
- Any change to the invite (`/join/{token}`) or launch-token (`/api/launch/{token}`) flows — both
  already bypass the create-family form entirely and are unaffected.

## Testing

- Go: `POST /api/family` twice — second call gets `409`, first family's rows are untouched.
- Go: `GET /api/status` returns `false` before any family exists, `true` after one is created.
- Playwright: fresh DB shows the onboarding form with the create-family fields present. A DB
  pre-seeded with one family shows the sign-in-only screen on root load, with no create-family
  fields present.
