# ADR 0004: Bearer tokens are HMAC-SHA256 hashed with a server-side pepper

- **Status:** Accepted
- **Date:** 2026-07-04
- **Context:** Google OAuth requires Hearth to be reachable from the public internet, so the server can no longer rely on Tailscale as the sole auth boundary (the README's original "Tailscale is the auth layer, no token hashing" framing). Session cookies, invite links, launch tokens, and pending-auth tokens are stored as raw `TEXT PRIMARY KEY` values across four tables (`sessions`, `invites`, `launch_tokens`, `pending_auth`). A leaked SQLite backup or misconfigured artifact bucket becomes an instant session-theft vector.

---

## Decision

Hash every bearer token with HMAC-SHA256 and a server-wide pepper before it touches the database, applied in place across all four token tables.

- **Hash:** HMAC-SHA256, not bare SHA-256 — bare SHA-256 leaves the DB directly redeemable as bearer credentials forever; HMAC stays deniable and rotatable via the pepper.
- **No per-row salt.** The inputs are already 256 bits of entropy from `crypto/rand`; a salt would have to live in the database next to the hash, defeating its purpose.
- **Pepper:** a server-wide secret from the `PEPPER` env var, never stored in the database. Comma-separated list, current first, fallbacks after — lookups try every pepper via `allHashes()`, inserts use the current one only (`server/tokens.go`).
- **Rotation:** prepend the new pepper, append the old one, deploy, wait out the grace window, then drop the fallback. Forces re-login for any session predating the new pepper (the 10-year cookie TTL bounds the grace window by the oldest live session, not by hours).
- **Migration:** in place, gated by a `token_hashed` sentinel column per table so the rewrite is idempotent across restarts — no new migration framework.
- Every read goes through `lookupByToken`, which returns the **matched hash**, not just a boolean. Every follow-up write in the same handler reuses that matched hash rather than recomputing `hashToken(plaintext)` — during a rotation window a row can only be found via a fallback pepper's hash, and recomputing produces the current pepper's hash, which silently matches zero rows.

## Threat model

**In scope:** a leaked database file or backup. Hash + pepper means dumped rows aren't directly redeemable; the pepper (env var / secrets manager only) is required to verify any hash.

**Explicitly out of scope, for the next reader:**
- In-flight tokens in URLs (`/api/join/{token}`, `/api/launch/{token}`, conflict-resolution query params) still carry raw values and land in access logs/Referer headers until their short TTL expires. `server/logging.go` redacts these paths, but redaction doesn't shorten the exposure window.
- `push_subscriptions.p256dh`/`auth` are bearer-equivalent for a malicious push gateway and aren't covered — a DB leak still lets an attacker impersonate the subscriber. Follow-up work.
- `pending_auth` rows have no `expires_at` and accumulate forever; hashing doesn't fix that.
- Multi-replica deployment: the in-place migration assumes single-process startup. Multiple replicas against a shared DB would race it; needs an external advisory lock if that deployment shape happens.

## Consequences

- (+) A leaked SQLite backup no longer directly yields usable sessions, invite links, or launch tokens.
- (+) Rotation is possible without invalidating every session at once (comma-separated pepper fallback list).
- (−) Every existing deployment without `PEPPER` set fails to start after upgrading — a deliberate fail-fast breaking change, not a silent default.
- (−) Every write handler now hashes before insert and every read goes through the rotation-aware `lookupByToken` helper instead of a plain `WHERE token = ?`.

## Alternatives considered

- **Bare SHA-256, no pepper.** Rejected — a leaked DB alone would be sufficient to forge sessions; the hash provides no protection without a secret the DB itself doesn't hold.
- **Per-row salt.** Rejected — the token values are already high-entropy random data; a salt adds no security here and would sit in the same leaked row as the hash.
- **Leave Tailscale as the only auth boundary.** Rejected — OAuth requires public internet reachability, which breaks that assumption outright.
