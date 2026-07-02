# Caching Strategy

Hearth is a PWA: `sw.js` intercepts every same-origin fetch once installed, which means the
service worker is both the thing that makes the app work offline and the thing most capable of
serving a user stale code. This doc covers every layer that caches something, and every
mechanism that exists to keep those layers from serving stale data.

## The bug this doc exists because of

2026-07-02: a device kept running old, broken sync code for hours after fixes had shipped and
were live on the server. Root cause: `GET /sw.js` had no `Cache-Control` header, so the browser
applied [RFC 9111 §4.2.2](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.2) heuristic
freshness (~10% of the time since `Last-Modified`) and served its own stale HTTP-cached copy of
the service worker script — never even fetching the new one, so none of the update machinery
below ever ran. See `dba7e1d`. That's the failure mode every rule here defends against: **a cache
that never gets told it's wrong just sits there being wrong.**

## The layers, outside in

### 1. Browser HTTP cache → `sw.js` itself

The one request no service worker can intercept is the browser's own fetch of the service worker
script. That fetch is governed entirely by response headers from the server.

- `server/router.go` serves `GET /sw.js` with `Cache-Control: no-store` — every registration
  check and periodic update check hits the network, every time. No heuristic freshness, no
  conditional-GET revalidation window, nothing to go stale.
- Browsers additionally force a revalidation of the top-level SW script at least once every 24
  hours regardless of headers (spec-mandated backstop). The explicit header means we don't rely
  on that as the only defense — 24 hours of stale sync is not an acceptable failure mode.

Nothing else on the server sets `Cache-Control` (checked: only `/api/events`, for a different
reason — see below). `index.html`, `styles.css`, and every `js/*.js` file are served with no
explicit cache header, relying on the layers below instead.

### 2. Service worker install → Cache Storage (`sw.js`)

```js
const VERSION = 'hearth-<UTC timestamp>';
```

- Every deploy that touches a cached asset gets a new `VERSION` string (see "Version bump"
  below). Cache Storage buckets are keyed by `VERSION`, so a new deploy always writes into a
  brand-new, empty bucket — it can never inherit stale entries from the previous one.
- `install` primes that bucket with the `SHELL` array (the app's core files) via
  `caches.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))`. The `{ cache: 'reload'
  }` fetch option forces each of those fetches to bypass the *browser's* HTTP cache too — without
  it, a heuristically-fresh disk-cache entry for e.g. `changelog.js` could hand back stale content
  during install, poisoning the new version's Cache Storage bucket even though the bucket itself
  is fresh. (Fixed in `0a5bc6c` — the install-time counterpart to the `/sw.js` header fix above.)
- `activate` deletes every Cache Storage bucket whose key isn't the current `VERSION`, then calls
  `self.clients.claim()` so the new worker takes control of already-open tabs immediately instead
  of waiting for a full reload.

### 3. Service worker runtime fetch handling (`sw.js`)

Four routing rules, most-specific first:

| Request | Strategy | Why |
|---|---|---|
| `mode: 'navigate'` (page loads) | Network-first, fall back to cached `index.html` | Always get the latest shell when online; still boot offline. |
| Cross-origin (font/icon CDNs) | Cache-first, populate on miss | Third-party assets rarely change; avoid refetching them every load. |
| `/api/*` | Bypassed entirely (`return` — no `respondWith`) | API responses are never static; the service worker must never intervene between the client and live data. |
| Same-origin assets (everything else) | Cache-first, populate on miss | Fast repeat loads; correctness comes from the `VERSION`-bucket swap on update, not from per-request freshness checks. |

The cache-first same-origin rule is *why* the `VERSION` mechanism has to work: once a worker is
active, it will keep answering JS/CSS requests from its own bucket indefinitely. The only way a
client ever sees new code is a new worker activating with a new bucket.

### 4. Client-side update propagation (`js/app.js`)

Getting a new service worker installed isn't the same as the open tab using it. Two behaviors
close that gap:

- On `controllerchange` (fired when a new worker takes control), the page reloads so the open
  tab starts using the new worker's cache. A guard (`hadController`) skips the event that fires on
  first load, so this only applies to an in-place update while the tab is open. If a bottom sheet
  is open, the reload is deferred, a `Refresh` toast appears, and the page reloads after the sheet
  closes if the user ignores the toast.
- `activate`'s `self.clients.claim()` (layer 2) is what makes `controllerchange` fire promptly
  instead of waiting for the tab to close and reopen.

### 5. SSE endpoint (`server/sse.go`)

`Cache-Control: no-cache` on `/api/events` — a different concern from the layers above (this
endpoint was never at risk of being cached long-term), but it matters for the same class of bug:
intermediary proxies must not buffer or cache a streaming response, or push events stop arriving
in real time. Set alongside `Content-Type: text/event-stream` and the flush-per-message forwarding
fixed in `3ad703c`.

## The version bump (the thing that ties it together)

```bash
scripts/bump-version.sh
```

Sets `<meta name="version">` in `index.html` and `const VERSION` in `sw.js` to the same UTC
timestamp. This is the cache buster: it's what makes `VERSION` new on every relevant deploy, which
is what makes Cache Storage bucket names new, which is what makes `activate` evict the old bucket.
**Run before every commit that touches a cached user-facing asset** (`js/`, `index.html`,
`styles.css`, `sw.js`, `assets/`, `icons/`) — skip it and the deploy is invisible: same bucket
name, same cached files, nothing changes for any client no matter what the diff says.

The same `<meta name="version">` value doubles as the "what's new" changelog marker
(`currentVersion()` in `js/changelog.js`) and the build timestamp shown in Profile
(`buildStamp()` in `js/profile.js`) — unrelated to caching, but worth knowing it's the same string
serving three jobs.

## Quick mental model

- **Can go stale, has an explicit fix:** `/sw.js` HTTP response (`no-store` header),
  shell-file fetches during install (`cache: 'reload'`), Cache Storage buckets (`VERSION` key +
  `activate` eviction).
- **Deliberately never cached:** `/api/*` (skipped by the fetch handler entirely), `/api/events`
  (`no-cache` header, streaming).
- **Cached with no explicit staleness guard, by design:** cross-origin font/icon requests
  (acceptable — third-party assets, not code) and every same-origin asset once a worker is
  active (acceptable — correctness comes from the bucket swap, not from per-request checks).
- **The one thing that makes all of the above actually reach a client:** the version bump. If it's
  skipped, every other mechanism in this doc is inert.
