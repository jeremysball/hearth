# PWA Invite Install Design

**Date:** 2026-06-26

## Problem

When an invited caregiver opens a Hearth invite link in Safari on iOS, they complete the join flow in the browser. Safari does not fire `beforeinstallprompt`, so there is no in-app prompt to install the PWA. If they manually add to Home Screen anyway, iOS versions below 16.4 give the installed PWA a separate cookie/storage context — the session set during join in Safari does not carry over, and the PWA opens to onboarding as if unauthenticated.

## Solution

After a successful join in browser mode, generate a short-lived single-use launch token on the server and embed it in the URL as `/?launch=<token>`. The user adds that URL to their Home Screen. When they open the installed PWA, the app exchanges the launch token for a real session cookie via a server endpoint. Both the "no install prompt" and "lost session" problems are solved in a single mechanism that works on all iOS versions.

## Flow

1. Invited person opens `/join/<token>` in Safari.
2. Enters their name, taps "Join family."
3. `POST /api/join/<token>` — server creates caregiver, sets session cookie, returns success.
4. Client checks `window.matchMedia('(display-mode: standalone)').matches`. If **not** standalone:
   - `POST /api/launch-tokens` (with `credentials: 'include'`) — returns `{ token }`.
   - `history.replaceState(null, '', '/?launch=<token>')` — bakes token into current URL.
   - Renders install guide screen. Does **not** route to home.
5. User follows install guide: Share → Add to Home Screen → Add.
6. User opens the installed PWA. It opens at `/?launch=<token>`.
7. `init()` detects `?launch=` in `location.search`.
8. `GET /api/launch/<token>` (`credentials: 'include'`) — server validates, creates a new session, sets cookie via `Set-Cookie` header, marks token used.
9. `history.replaceState(null, '', '/')` — strips token from URL.
10. Normal boot proceeds: `router.boot()` → home.

**Error case:** if the launch token is expired or already used, render a message: "This install link has expired — ask to be invited again." Do not attempt to boot the app.

**Already-standalone case:** if `joinFinish` runs inside an already-installed PWA (unlikely but possible), skip the launch token entirely and proceed as today.

## Server

### New DB table (migration in `server/db.go`)

```sql
CREATE TABLE launch_tokens (
  token        TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  family_id    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);
```

### New file: `server/launch_tokens.go`

**`POST /api/launch-tokens`** — requires authenticated session.
- Reads `caregiver_id` and `family_id` from session.
- Generates token via `newID()`.
- Sets `expires_at` = now + 10 minutes.
- Inserts into `launch_tokens`.
- Returns `{ "token": "..." }`.

**`GET /api/launch/{token}`** — no auth required.
- Looks up token. 404 if not found.
- 410 if `used_at` is set or `expires_at` is past.
- Calls `createSession(db, caregiverID, familyID)` and `setSessionCookie(w, sessToken)` — same pattern as `handleJoinInvite`.
- Sets `used_at = nowISO()`.
- Returns `{ "ok": true }`.

Both routes registered in `server/main.go`.

## Client

### `js/join.js`

**`joinFinish` change:** after the existing join fetch succeeds and before the existing sync/save/route block, add:

```js
if (!window.matchMedia('(display-mode: standalone)').matches) {
  const ltRes = await fetch('/api/launch-tokens', { method: 'POST', credentials: 'include' });
  const { token } = await ltRes.json();
  history.replaceState(null, '', '/?launch=' + token);
  $('#app').innerHTML = installGuideView();
  return;
}
// existing sync/save/route continues here for standalone case
```

**New `installGuideView()` function** in `join.js`:
- Uses the same `.onboard` shell as the join screen for visual continuity.
- Heading: "You're in! Now install Hearth."
- Sub: "Follow these steps to add Hearth to your Home Screen."
- Three numbered steps for iOS: tap the Share icon → tap "Add to Home Screen" → tap "Add."
- Detect iOS vs Android via `navigator.userAgent`:
  - iOS: show the three steps with inline SVG share icon.
  - Android: "Chrome will prompt you to install — tap Install when it appears, or use the browser menu → Add to Home Screen."
- Small note at bottom: "This install link expires in 10 minutes."

### `js/app.js`

**`init()` change:** add a launch-token check at the very top of `init()`, before the existing join-path check:

```js
const launch = new URLSearchParams(location.search).get('launch');
if (launch) {
  const res = await fetch('/api/launch/' + launch, { credentials: 'include' });
  history.replaceState(null, '', '/');
  if (!res.ok) {
    $('#app').innerHTML = `<div class="onboard"><p class="onb-sub">This install link has expired — ask to be invited again.</p></div>`;
    return;
  }
  // cookie now set — fall through to normal boot
}
// existing join-path check follows
```

`init()` must be made `async` if it is not already.

## Token parameters

| Property | Value |
|----------|-------|
| TTL | 10 minutes |
| Single-use | Yes — `used_at` set on first redemption |
| Format | Same `newID()` as all other tokens |
| Auth required to create | Yes (session cookie from completed join) |
| Auth required to redeem | No |
