# Accounts & OAuth — Delegation Handoff

> **Note:** Historical handoff brief — the plan it supervises (`2026-06-27-accounts-and-oauth.md`) is COMPLETE on `main`. Kept for reference, not actionable.

**Verdict: ~90% delegatable.** Three plan bugs were fixed inline before this brief was written. Three items are supervisor-inline; one is human-only. The remainder is exact-edit opencode work.

**Load order for the supervisor:** Load the `delegating-to-opencode` skill before doing anything else.

---

## Pre-resolve checklist (already done — DO NOT redo)

These bugs were fixed in the plan before this brief was written:

1. **Task 1 Step 2** — `server/config_test.go` already exists; plan changed from "Create" to "Append the function to the existing file."
2. **Task 4 Step 3 reconcile.go** — `defaultCards` was `{"bottle":true,...}` (missing `sweetspot`); fixed to match `handleCreateFamily` in `server/family.go:73`.
3. **Task 7 Step 1 account.js + Step 5** — `handleAuthRedirect` lacked an `onSignup` callback path for the `signedup + fresh device` case; fixed with exact callback signature and exact `init()` replacement block. `syncOnce` and `connectEvents` are not exported from `app.js` — the fix keeps them internal and passes the boot sequence as a callback.

---

## Three-Tier Triage

### Opencode-delegatable (unattended)

All steps in Tasks 1–7 except those listed below. Specifically:

- **Task 1:** Steps 1–7 (config, docs, env, tests)
- **Task 2:** Steps 1–5 (schema)
- **Task 3:** Steps 1–3, 5–7 (goth init, begin route, wiring)
- **Task 4:** Steps 1–8 (callback, reconcile)
- **Task 5:** Steps 1–6 (me, signout)
- **Task 6:** Steps 1–7 (conflict info, resolve, merge)
- **Task 7:** Steps 1–4, 6–9, 11 (account.js, profile, onboarding, CSS, Playwright, version bump + commit)

### Supervisor-inline (mid-tier model, NOT opencode)

**S1 — Task 3, Step 4: Apple provider API verification**

After opencode runs `go get github.com/markbates/goth@latest` and `go mod tidy`, the build in Step 6 will reveal if `github.com/markbates/goth/providers/apple` compiles with the `apple.New(id, secret, callbackURL, nil, apple.ScopeName, apple.ScopeEmail)` signature. The plan documents this as a known limitation: Apple sign-in will NOT work live until `apple.MakeSecret` wiring is added; Google is fully functional as written. If the build fails on the Apple import, the supervisor fixes the import path or constructor signature by checking `go doc github.com/markbates/goth/providers/apple`, updates `server/oauth.go`, and reruns the build. This is a one-time disambiguation, not design work.

**S2 — Task 7, Step 10: Live end-to-end verification**

Requires real Google/Apple credentials in `.env` and a reachable `PUBLIC_BASE_URL`. If the human has registered credentials (Task 1 prerequisite), the supervisor can run this verification. If not, it is human-only (see below). Either way it is not opencode's.

**S3 — Final QA pass**

After Run 2 completes, the supervisor does an independent review of the diff — not trusting opencode's self-report. Checks: does `npm run check` pass, do `cd server && go test ./...` and `node tests/run.js` pass, does the Playwright account test pass, does the version bump exist in both `index.html` and `sw.js`.

### Human-only (parked)

**H1 — Developer-console registration**

Register the Google OAuth 2.0 client and the Apple Services ID + Sign in with Apple key in their respective developer consoles. Supply the resulting credentials as env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `PUBLIC_BASE_URL`). This is a prerequisite for any live OAuth flow. Without it the app boots normally in anonymous mode; all tests pass.

---

## Run-splitting guidance

**Two opencode runs, each supervised at the gate.**

### Run 1: Tasks 1–4 (Go backend — schema, config, providers, callback/reconcile)

No frontend changes, no version bump. All Go.

- Task 1: Config plumbing + env + docs
- Task 2: Schema (`identities`, `pending_auth`)
- Task 3: goth init + begin route — **supervisor gates here after Step 6 build to verify Apple import**
- Task 4: Callback + reconciliation

Token budget: ~4 tasks × 25k ≈ 100k tokens — well within ceiling.

Gate after Run 1: Supervisor verifies `go build ./...` passes and all tests green. If Apple import failed, supervisor fixes and re-triggers opencode for just the affected file (or fixes inline).

### Run 2: Tasks 5–7 (Go endpoints + Frontend)

Tasks 5–6 are Go-only; Task 7 is the single frontend task that carries the version bump.

- Task 5: `/api/me` + signout
- Task 6: Conflict info + resolve (keep/switch/merge)
- Task 7: `js/account.js`, profile, onboarding, CSS, Playwright test, **version bump**

Token budget: ~3 tasks × 25k ≈ 75k tokens — within ceiling.

Gate after Run 2: Supervisor runs `npm run check`, `cd server && go test ./...`, `node tests/run.js`, confirms version bump in `index.html` and `sw.js` match (format: `YYYY-MM-DDTHH:MMZ` / `hearth-YYYY-MM-DDTHH:MMZ`). Does the independent QA pass. If credentials available, runs Task 7 Step 10 live e2e.

---

## Scope note

- opencode runs the automated suites (`go test`, `npm run check`, Playwright). It cannot visually confirm UI, observe live OAuth redirects, or check the running app in a browser. Those belong to the supervisor and the human.
- The `hearth:run` skill is available for the supervisor to launch the app and visually verify the sign-in pills and conflict sheet render correctly.
- The CLAUDE.md rule "PUSH IMMEDIATELY AFTER EVERY COMMIT TO `main`" applies: after each opencode commit, the supervisor pushes. Do not batch commits and push later.

---

## To launch Run 1

From the `hearth` directory:

```
opencode run --plan docs/superpowers/plans/2026-06-27-accounts-and-oauth.md --tasks 1-4
```

(Exact invocation syntax depends on your opencode version — adapt as needed.)

**This brief ends here. Starting the run is the human's action.**
