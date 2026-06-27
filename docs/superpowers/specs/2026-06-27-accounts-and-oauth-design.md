# Hearth — Accounts & OAuth

**Date:** 2026-06-27
**Status:** Approved design, pre-plan

Adds opt-in, OAuth-backed accounts to Hearth so a caregiver has a durable identity for
multi-device sync/backup and sharing. Anonymous local-first usage remains fully
supported; accounts are never required.

Split out from `2026-06-27-fixes-timeline-and-accounts-design.md` so it gets its own
implementation plan — it is by far the largest piece, touches the backend, schema, and
security, and depends on an external prerequisite (developer-console OAuth app
registration).

## Principles carried in

- Vanilla JS PWA + Go + SQLite. No framework. No managed third-party auth service.
- Integrity and availability of user data above all else — no silent data loss.
- Local-first: accounts are opt-in; anonymous usage stays fully supported.
- Self-hostable and private — identities live in our own SQLite, not a SaaS.

## Current state (foundation)

There is no real "account" today. Identity is an anonymous, long-lived session cookie
(`hearth_session`, ~10y, revoked by deleting the row). A family is created anonymously
via `POST /api/family`; caregivers join via invite links; sessions move between devices
via launch-token links. Schema already has `families`, `babies`, `caregivers`,
`sessions`, `invites`, `launch_tokens` (`server/schema.sql`). Auth plumbing
(`requireAuth`, `createSession`, `setSessionCookie`) lives in `server/auth.go`.

OAuth adds a durable identity that anchors a caregiver — replacing the launch-link dance
for "sign in on a new device and get my data back."

## Library & providers

- **`markbates/goth`** inside the existing Go server (fallback: `coreos/go-oidc` +
  `golang.org/x/oauth2` if goth proves awkward for Apple's flow).
- Providers for v1: **Google** and **Apple**.
- **Prerequisite (manual, project owner):** register OAuth client apps in the Google
  and Apple developer consoles; supply client IDs/secrets and redirect URLs via config
  (extend `server/config.go` to read them from env). This is setup, not code, and blocks
  the callback flow until done.

## Data model

Build on the existing schema. Add one table:

```sql
CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL,          -- 'google' | 'apple'
  provider_user_id  TEXT NOT NULL,          -- stable subject id from the provider
  caregiver_id      TEXT NOT NULL REFERENCES caregivers(id),
  email             TEXT,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_caregiver ON identities(caregiver_id);
```

An identity links one provider account to one existing caregiver (and therefore that
caregiver's family). Sessions remain the long-lived cookie mechanism, unchanged.

## Endpoints (Go)

- `GET /api/auth/{provider}` — begin the OAuth flow (goth redirect).
- `GET /api/auth/{provider}/callback` — complete the flow, resolve the identity,
  establish/attach a session, and run the reconciliation logic below.
- `POST /api/auth/signout` — delete the current session row (existing revocation model).
- `GET /api/me` — report the signed-in identity for Profile display (provider, email).

All new authenticated endpoints reuse `requireAuth`; the auth-begin/callback routes are
public.

## Reconciliation logic (data-safety critical)

On a successful callback, resolve `(provider, provider_user_id)`:

1. **No existing identity, device has an anonymous family:** *link* — create an
   `identities` row pointing at the current caregiver. Existing data is preserved and
   now anchored to the account.
2. **Existing identity, clean device (no local data / fresh family):** *restore* —
   issue a session for the identity's caregiver/family; the existing `/api/sync` pulls
   the family's data down.
3. **Conflict — existing identity points to family B (with data), but the device
   already holds anonymous family A (with data):** *prompt the user* with three choices:
   - **Keep this device's data** — stay on family A. (Whether to also link the identity
     to A here is a plan-time decision.)
   - **Switch to my account** — use family B; family A retained locally as recoverable.
   - **Merge** — fold family A's id-keyed entries into family B with dedupe.

   Never silently discard. Local data is always retained as recoverable until the user
   explicitly chooses. The conflict prompt is a frontend sheet driven by a callback
   response that signals the conflict state rather than auto-committing.

## Frontend

- Sign-in buttons (Google, Apple) in onboarding (`js/onboarding.js`) and Profile
  (`js/profile.js`), styled as rounded pill buttons on-theme.
- Profile shows signed-in state (identity email/provider) and a Sign out action when a
  session is identity-backed.
- A conflict-resolution sheet (reconciliation case 3) reusing the existing sheet
  component.

## Verification

- Fresh anonymous user can sign in and have their existing local data linked (case 1).
- Same identity on a second/clean device restores the family (case 2).
- The conflict case surfaces the prompt and each choice behaves as specified, with no
  data loss (case 3).
- Anonymous-only users are never forced to sign in; the app works unchanged without an
  account.
- Sign out revokes the session.

## Out of scope (YAGNI)

- Email magic-link and GitHub providers (Google + Apple only for v1).
- Real-time merge-conflict resolution beyond id-keyed dedupe.
- Account deletion/data-export flows (separate future work).

## Implementation sequencing

Ordered milestones: developer-console registration (prerequisite) → schema/migration →
endpoints (begin/callback/signout/me) → reconciliation logic → frontend (sign-in
buttons, signed-in state, conflict sheet). Any change to a cached user-facing asset
bumps the version in `index.html` and `sw.js`.
