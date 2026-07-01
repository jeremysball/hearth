# Sonnet Handoff Brief — Fixes/Timeline & Accounts/OAuth

**Date:** 2026-06-27
**Planner:** Opus (this session). **Executor-supervisor:** Sonnet (you, next).
**Plans:**
- `docs/superpowers/plans/2026-06-27-fixes-and-timeline.md`
- `docs/superpowers/plans/2026-06-27-accounts-and-oauth.md`

## START HERE (for the Sonnet supervisor)

1. **Load the `delegating-to-opencode` skill before doing anything else.** It governs
   how you size runs, launch opencode in a detached `tmux` session, monitor cheaply,
   and do the final QA pass. This brief tells you *what* to delegate; that skill tells
   you *how*.
2. Work the **supervisor-inline** items yourself (below) — opencode cannot.
3. Delegate the **opencode-delegatable** tasks per the run-splitting plan.
4. Leave the **human-only** items parked; flag them to the user.

**Verdict:** ~90% delegation-ready. These are real implementation plans (exact
find/replace, exact verify commands, exact `git add` lists, Global Constraints with
the version-bump rule). Triage below.

---

## Three-tier triage

### Opencode-delegatable (unattended, exact edits + runnable verification)
- **Fixes:** Task 1, Task 2 (Steps 1–2, 4 — the CSS edits + commit), Task 4, Task 5
  (Steps 1–6, 8), Task 6, Task 7 (Steps 1–6, 8).
- **OAuth:** Tasks 2, 4, 5, 6 in full; Task 3 (after you verify the goth signatures —
  see below); Task 7 (Steps 1–4, 6–9).

### Supervisor-inline — YOU (Sonnet) handle these, not opencode
The user has confirmed you can take these on; escalate to the user only if one turns
into deep problem-solving.

1. **Fixes Task 3 — desktop date autofill.** Reproduce-first; the fix is unspecified.
   Diagnose live (`run`/`verify` skill), pin the exact change, then either apply it or
   write it into the plan as exact find/replace before delegating the rest of Phase 1.
2. **Fixes Task 2, Step 3 — slider visual re-tune.** opencode can paste the CSS
   (Steps 1–2); you do the screenshot pass and tune the glare opacity by eye.
3. **OAuth Task 3 — goth provider signatures. RESOLVED 2026-06-27 (Opus).** Verified
   against goth **v1.82.0** by installing it and compiling the plan's exact code:
   - `google.New(clientKey, secret, callbackURL string, scopes ...string)` — plan's call is correct as written.
   - `apple.New(clientId, secret, redirectURL string, httpClient *http.Client, scopes ...string)` — plan's `apple.New(id, sec, cb, nil, apple.ScopeName, apple.ScopeEmail)` is correct; both `apple.ScopeName` and `apple.ScopeEmail` exist.
   - The Step 1 sequence (`go get github.com/markbates/goth@latest` **then `go mod tidy`**) is required and sufficient — the bare `go get` does not pull the apple/google subpackage transitive deps (jwt, jwx, oauth2/google); `go mod tidy` does. `go build ./...` is then clean. The "adjust if it differs" hedge can be ignored — no adjustment needed.
   - **CAVEAT (not a blocker for the unattended run; flag to the user before any *live Apple* test):** the plan passes `AppleClientSecret` as a static string and never uses `AppleTeamID`/`AppleKeyID`. Real Apple sign-in needs a signed-JWT client secret generated via `apple.MakeSecret(apple.SecretParams{PKCS8PrivateKey, TeamId, KeyId, ClientId, ...})` (the .p8 key), which expires (≤6 months). Code compiles and all Go tests pass without this because the tests only exercise **google**; Apple live e2e is already parked (human-only). Google is fully correct and unblocked.
4. **Soft prose steps → exact edits.** Fixes Task 1 Step 3 ("call it where state is
   hydrated") and OAuth Task 7 Step 5 (boot-on-signup sequence): convert to concrete
   find/replace, or just execute them carefully yourself.
5. **All `run`/visual/live-browser verification steps and the final QA pass.** These
   are yours by definition — opencode self-reports are not evidence. Re-run the suites
   and re-test the actual behavior in your own session.

### Human-only — parked (neither opencode nor Sonnet can complete)
- **OAuth Task 1 — provider console registration.** Google Cloud + Apple Developer
  setup, `.env` creds, `PUBLIC_BASE_URL`. External, manual.
- **OAuth Task 7, Step 10 — live OAuth e2e.** Blocked on the above. Everything else in
  Task 7 can be built and Playwright-tested without it; the live credentialed
  round-trip waits for the user.

---

## Run-splitting (per `delegating-to-opencode` budget: ≤~8 tasks / ≤200k tok, ~23–25k tok/task)

Default: **one opencode session per phase.** Recommended runs:

| Run | Tasks | Notes |
|---|---|---|
| Fixes Phase 1 | 1–2 | Pull **Task 3 inline** first. Tasks 1–2 are mechanical. |
| Fixes Phase 2 | 4–5 | Task 5 has a visual check-in (Step 7) — your look, not opencode's. |
| Fixes Phase 3 | 6–7 | Task 7 has visual verify (Step 7) — yours. |
| OAuth backend | 2–6 | Go-only, **no version bump.** Verify goth sigs (Task 3) first. Task 1 is the human prereq. |
| OAuth frontend | 7 | **Carries the single version bump.** Active visual check-in; Step 10 parked for the user. |

**Version-bump scope:** OAuth Tasks 2–6 are Go-only → no bump. OAuth Task 7 and all
Fixes tasks touch cached frontend assets → bump `index.html` + `sw.js` per the repo
rule before each such commit.

**In every opencode launch prompt:** the `run`/visual steps are yours, not opencode's;
opencode runs the Playwright + Go + unit suites it *can* and must state plainly it
cannot visually confirm. Final QA is yours, in your session — mandatory, separate.

---

## Pre-resolve before launching the relevant run
- Fixes Task 3 diagnosed + fix pinned (before Phase 1). — *Fixes plan only; not needed for the OAuth-only handoff.*
- ~~OAuth Task 3 goth signatures verified (before OAuth backend run).~~ **DONE** — goth v1.82.0, see Supervisor-inline item 3. OAuth backend run is launchable now.
- Soft prose steps converted to exact edits (before their tasks are delegated). — *OAuth: only Task 7 Step 5 (boot-on-signup); supervisor-inline, OAuth frontend run, not the backend.*

## Codebase assumptions verified (Opus, 2026-06-27) — OAuth plan
Spot-checked the plan against the live tree; all hold:
- Session/auth helpers used by the plan all exist and match: `SessionInfo{CaregiverID,FamilyID}`, `sessionFrom`, `createSession`, `setSessionCookie`, `sessionCookieName="hearth_session"`, `requireAuth`, `newID`, `nowISO`, `withSession` (test helper). (`server/auth.go`, `server/db.go`, `server/testutil_test.go`)
- Schema columns the plan's SQL touches all exist: `log_entries(id,family_id,type,start,payload_json,created_by,updated_at,deleted_at)`, `growth_entries(...,deleted_at)`, `babies`, `settings`, `caregivers`, `families`. Additive `CREATE TABLE IF NOT EXISTS` for `identities`/`pending_auth` fits the existing startup-apply model. (`server/schema.sql`)
- The signup branch in `reconcile` correctly mirrors `handleCreateFamily` (`server/family.go`). Minor, harmless: plan's default `cards_json` omits the now-removed `sweetspot` key (commit 587bac4), so it is *more* current than `handleCreateFamily` — leave as the plan has it.
- `newRouter` signature change (Task 3 Step 5) has exactly **two** call sites to update besides `main.go`: `server/router_test.go:13` and `:34` — both must get a zero `Config{}`. The plan already calls this out.
- **go.mod lives at the repo root** (`/workspace/hearth/go.mod`, module `github.com/jeremysball/hearth`), not in `server/`. The plan's `cd server && go ...` commands still operate on the whole module, so they work — but `go.sum`/`go.mod` edits land at the repo root, and the Task 3 `git add go.mod go.sum` must reference the **root** paths, not `server/go.mod`. Tell opencode this so the commit doesn't silently miss the dependency files.
