# ADR 0001: Multi-Caregiver Backend & Sync Architecture

- **Status:** Accepted
- **Date:** 2026-06-23
- **Context:** Hearth is currently a single-device PWA — all state (baby profile, log entries, growth, settings) lives in one browser's `localStorage`, with no server and no concept of an account. This ADR covers the decisions needed to support multiple caregivers sharing one baby's data, kept in sync, on a self-hosted server.

Each section below is a separable decision: status, context, decision, consequences, alternatives considered.

---

## 1. Backend stack: Go + SQLite, single static binary

**Decision:** Build the server in Go, using SQLite (via a pure-Go driver, e.g. `modernc.org/sqlite`, to avoid cgo cross-compile pain) as the only datastore. The binary serves the static PWA, the REST API, and SSE on one port, replacing the standalone `serve.js`.

**Context:** This runs on the user's home Linux server, for one (or a handful of) families — not a multi-tenant SaaS. No managed backend-as-a-service (BaaS) is in scope; everything is self-hosted.

**Consequences:**
- (+) Single artifact to deploy (`go build`, one systemd unit), minimal idle resource footprint, trivial backup (`cp hearth.db hearth.db.bak`).
- (+) SSE is native to Go's `net/http` (goroutine + flushed `ResponseWriter`) — no extra library.
- (−) Second language in the codebase alongside the frontend's vanilla JS (acceptable trade for the ops simplicity).
- SQLite serializes writes, but at "a few caregivers logging diaper changes" volume this is not a real constraint.

**Alternatives considered:** Node+SQLite (same language as frontend, but heavier idle footprint and a separate static-file process unless folded in); Go+Postgres (more operational overhead — a second service to run/back up — only justified if scaling to many unrelated families, which is explicitly out of scope); any BaaS (ruled out per requirement).

---

## 2. Joining a family: shareable invite link

**Decision:** The family admin generates a one-time-token invite link (`https://hearth.<tailnet>/join/<token>`). Opening it lets the recipient create their caregiver profile and links their device to the family. Tokens expire and are marked used on consumption.

**Alternatives considered:** Short manually-typed invite code (more friction, no real benefit here); QR code (good for in-person handoff, awkward remotely — link supersedes it since both caregivers are typically reachable by text/Tailscale already).

---

## 3. Account scope: one family per caregiver account (v1)

**Decision:** Each caregiver account belongs to exactly one family. `family_id` lives directly on the account/session — no membership join table.

**Context:** The stated requirement is multi-caregiver *on a single baby*, not multi-tenant family-switching (e.g., a nanny covering two unrelated households). 

**Consequences:** (+) Simpler schema and simpler auth. (−) A caregiver helping two separate families would need two separate logins — acceptable, not a stated use case. Revisit if that need actually arises; it's an additive change (join table + family switcher), not a rewrite.

---

## 4. Single baby per family (v1)

**Decision:** A family has exactly one baby. No multi-baby (twins/siblings) support yet.

**Consequences:** Matches today's data model exactly, minimizing client rework. Revisit if/when twins or siblings under one family become an actual requirement — additive change (family → babies becomes one-to-many), not a rewrite.

---

## 5. Offline-first sync: local outbox + SSE-triggered pull

**Decision:** Client writes still hit `localStorage` immediately (unchanged UX — instant, works offline). Each write also appends to a local `outbox` queue. A sync loop drains the outbox to the server on load, on the browser `online` event, on an incoming SSE signal, and on a ~30s fallback timer. `GET /api/sync?since=<ts>` returns all rows changed since `since`, including soft-delete tombstones, for the client to merge by id.

**Context:** The app's offline capability (PWA, log a 3am feed with no signal) is a core existing feature; multi-caregiver sync must not regress it.

**Conflict handling:** Log/growth entries are append-mostly with independent ids — true conflicts are rare by construction. Shared singleton resources (baby profile, settings) use last-write-wins: the server always accepts the incoming write and stamps `updated_at`. This is an explicit simplification appropriate at family scale (a handful of low-frequency editors), not a general CRDT/OT solution.

**SSE's role:** The server pushes a bare `changed` signal to other connected caregivers' devices on any write. Clients respond by pulling `/api/sync`, rather than receiving payloads over SSE directly — this keeps the push channel trivial (no payload protocol, no dedup logic) while still feeling instant on a LAN/tailnet.

**Alternatives considered:** Require connectivity to log (simpler, but a real regression from current behavior — rejected).

---

## 6. Authentication: persistent device session, no password — relying on Tailscale as the network perimeter

This is the most consequential decision here and deserves the most explicit reasoning.

**Decision:** Joining via an invite link issues that device a long-lived session token, set as an **httpOnly, Secure cookie**. There is no password, no email, no password-reset flow. A lost or wiped device is recovered by the family admin issuing a fresh invite link, not by an account-recovery flow.

**Context — the actual threat model:** The server is reachable *only* over the user's Tailscale network. Tailscale already gates which physical devices can route a single packet to this server at all, via its own authenticated, encrypted mesh and the user's tailnet ACLs. Any caregiver's device that can reach `/api/...` has, by definition, already passed a stronger authentication check (Tailscale's) than a typical username/password screen provides. A second app-level credential gate in front of that is largely redundant for *this* perimeter — it adds engineering surface (password storage, reset flows, email delivery infrastructure this home server doesn't have) without a corresponding increase in the security actually being provided.

**What this decision explicitly does NOT protect against** (documented so it's revisited deliberately, not by accident):
- **A device that is both tailnet-admitted and physically compromised** (lost while unlocked, stolen, borrowed). The session cookie alone grants access — there is no PIN/passcode layer in v1 (the user considered and explicitly deferred a PIN option during design).
- **Tailscale ACL misconfiguration** — if the tailnet's ACLs are ever loosened to admit a broader set of devices than intended, this app inherits that exposure with no independent backstop.
- **Any future requirement to expose this server outside the tailnet** (e.g., sharing with a caregiver who won't install Tailscale, or putting it behind a public reverse proxy for convenience). That would silently invalidate this entire decision's premise — the server would then be reachable by anyone on the internet with only an httpOnly cookie standing between them and a family's baby-health data.

**Revisit this decision if:**
- The server is ever exposed beyond the Tailscale network.
- A caregiver's lost/stolen device becomes a real incident (not hypothetical) — add a PIN-lock layer (already scoped during design, just not built for v1).
- The household wants the ability to remotely revoke a specific device's session (straightforward addition: delete its `sessions` row server-side; the device gets a 401 next request) — worth building proactively even though nothing forces it yet, given the stakes of a lost-device scenario.

**Alternatives considered:** Lightweight PIN per caregiver (deferred, see above — cheap to add later, not worth the friction now); full email+password auth with reset flows (rejected as disproportionate engineering for a perimeter Tailscale already secures, and this home server has no mail infrastructure to build reset flows on top of).

---

## 7. Settings scope: appearance is per-device, everything else is family-shared

**Decision:** Dark mode and the girl/boy color theme remain a personal, per-device `localStorage` preference, never synced. Baby profile, log entries, growth entries, reminder configuration, units, and the caregiver list are family-shared and sync through the server.

**Rationale:** One caregiver preferring dark mode shouldn't change what their partner sees. Everything else is genuinely shared state about one baby and should look the same to every caregiver.

---

## 8. Reminder delivery: Web Push, not local `setTimeout` scheduling (revised)

**Status:** Supersedes an earlier "local-per-device" decision made during initial design — corrected after review.

**Original decision (rejected):** Keep today's client-side `setTimeout`-based reminder scheduling (`reminders.js`), unchanged, per-device.

**Why it was wrong:** `setTimeout` timers only run while the page is alive. They do not survive the tab/app being closed, and are unreliable once backgrounded (mobile browsers, especially iOS Safari/PWA, aggressively suspend backgrounded JS). A reminder that only fires "if the app happens to be open" defeats the actual purpose of a reminder — being told about a 3am medicine dose when the phone is asleep is the entire point.

**Revised decision:** Use Web Push. The server — which already has all synced log/settings data — computes due reminders on a periodic scheduler (porting the logic in today's `derive.reminders()` server-side) and sends a push message via VAPID to each subscribed caregiver device. The service worker's `push` event handler calls `self.registration.showNotification(...)`, which works even with zero pages open. The server becomes the single source of truth for scheduling and sending; the client's `setTimeout` scheduler is retired entirely to avoid duplicate notifications from two schedulers disagreeing.

**Added scope this introduces:** VAPID key generation, a `push_subscriptions` table (caregiver_id, endpoint, keys), client-side subscription flow (`pushManager.subscribe`), a server-side scheduler loop, and a `push` handler in `sw.js`. This is real, separate work from the SSE sync channel — SSE only delivers while a tab is open; Web Push is what reaches a closed app.

---

## Open follow-ups not yet decided
- Device session revocation UI (admin-facing "remove this device" screen) — flagged in §6 as worth building proactively, not yet scheduled.
- Whether quiet-hours/reminder preferences are per-caregiver or family-wide (today they're a single shared `settings.reminders` block; this ADR doesn't change that, but it's worth a deliberate look once Web Push lands, since two caregivers might reasonably want different quiet hours).
