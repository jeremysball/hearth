# Hearth — Fixes, Timeline, and Accounts

**Date:** 2026-06-27
**Status:** Approved design, pre-plan

A single combined design pass covering seven requested items: three bug fixes, two
card features, the Timeline feature, and OAuth-backed accounts. Implementation is
sequenced in phases so the smaller items ship without waiting on accounts.

## Principles carried in

- Vanilla JS PWA + Go + SQLite. No framework.
- Integrity and availability of user data above all else — no silent data loss.
- Local-first: accounts are opt-in; anonymous usage stays fully supported.
- Round controls, glass language, Lucide icons, Archivo/Playfair type.
- Bump `index.html` + `sw.js` version on every user-facing asset change.

---

## Phase 1 — Quick fixes

### 1.1 Profile segmented "slider" thumb not showing

**Symptom:** In Profile → Units & preferences (and Appearance), the selected option
highlights (`.seg-opt.on`) but the sliding `.seg-thumb` pill never appears.

**Mechanism:** The thumb is positioned imperatively by `positionThumb()` /
`initThumbs()` in `js/ui.js`, which measures `active.offsetWidth` / `offsetLeft`.
`router.go()` (`js/app.js:83`) calls `initThumbs($('#view'))`, but `router.refresh()`
(`js/app.js:90`) does not — so any refresh-driven re-render leaves thumbs at width 0.
`positionThumb()` also bails early when there is no `.seg-opt.on`, which happens if a
stored setting value does not match any option's `data-val`.

**Fix:**
1. Call `initThumbs($('#view'))` from `router.refresh()` as well as `router.go()`.
2. Audit `segBind()` callers in `js/profile.js` for value↔option-type mismatches
   (notably `settings.clock24`, which may hold a boolean rather than `'12h'`/`'24h'`);
   normalize so the stored value always matches an option `v`.
3. Confirm the fix live in the running app (all six Profile segmented controls show
   their thumb on first navigation and after a refresh).

**Verification:** Reproduce in-browser first, then confirm the thumb renders for every
Profile segmented control on initial nav and after toggling another setting.

### 1.2 Refined-glass slider restyle

**Symptom:** The segmented control thumb reads as muddy/heavy.

**Cause:** `.seg-thumb` (`styles.css:770-792`) stacks three layered gradients (the
moving glare, plus two radial gradients) and a fire-coupled drop shadow
(`var(--fire-a)` term), over a `backdrop-filter` track.

**Fix:** Keep the glass feel but strip it back:
- Remove the two radial-gradient background layers; keep the moving glare highlight.
- Replace the fire-coupled shadow term with one static soft cast shadow plus one crisp
  top inset highlight.
- Re-tune against a live screenshot in both light and dark mode (preserve the existing
  `[data-mode="dark"] .seg-thumb` treatment, simplified the same way).

**Verification:** Screenshot light and dark; thumb reads crisp, not muddy; glare still
tracks selection.

### 1.3 Desktop date does not autofill

**Symptom:** On desktop, opening a logging sheet (sleep, feed, etc.) leaves the date
portion of the `datetime-local` field unfilled.

**Mechanism (to confirm live):** `nowLocalDT()` (`js/ui.js:313`) returns a valid
`YYYY-MM-DDTHH:MM` string used as the input's `value=`, so the value *should* populate.
This is a reproduce-first bug — likely tied to how the sheet HTML is injected or the
input is (re)rendered. Diagnose with systematic-debugging in the browser; do not guess
a fix.

**Verification:** On desktop, every logging sheet opens with both date and time
prefilled to now.

---

## Phase 2 — Card features

### 2.1 Bath days-since card

Bath is already an addable card type (`js/home.js` `CARD_TYPES`). Give the bath card a
days-since display derived from the most recent `bath` log entry:

- "Last bath — Today" / "Yesterday" / "2 days ago" / "Never" when none logged.
- No target interval, no reminder (explicitly out of scope for v1).
- Tapping the card opens the bath logging sheet (consistent with how other log cards
  open their sheet via `log:open`).

**Verification:** Card shows correct elapsed-days text against seeded/real bath entries;
updates after logging a bath.

### 2.2 Medicine card redesign

Removes today's dead-end loop where the card says "Tap to add" but `log:open` opens a
sheet reading "add via the card," with the only real add path being the small edit
button.

**No medicines defined:** card shows a **+** affordance and "Add a medicine." Tapping
the whole card opens the *create-medicine* form (name / dose / unit) — the same form the
edit button reaches today.

**Medicines defined:** tapping the whole card opens a **dose picker** — a chooser of the
defined medicines to log a dose for. If exactly one medicine exists, log it directly
(with an undo toast). The card continues to surface the next-due medicine as its label.

The small edit/preferences button keeps managing the medicine list (add/remove/edit
definitions) as it does now.

**Touched code:** `js/home.js` `medicineCard()` (the `data-action`/empty-state branch),
and `js/sheets.js` medicine card/sheet handlers (`med:add`, the `medicine` form, and a
new dose-picker path).

**Verification:** Empty state shows + and opens create-medicine; with one medicine, tap
logs a dose; with several, tap opens the picker; edit button still manages the list.

---

## Phase 3 — Timeline

A **filterable, day-grouped activity feed**, opened from **Home** (not a sixth bottom
tab).

**Entry point:** A "History"/"Timeline" affordance on Home (header button or card) that
opens the Timeline as a full sub-view. Five bottom tabs unchanged.

**Layout:**
- Reverse-chronological list of all `state().log` entries.
- Day-group headers: "Today", "Yesterday", then dated (e.g. "Tue, Jun 24").
- Each row: type icon (existing `TYPES[type].icon`/`tone`) + label + key detail
  (e.g. "Bottle · 120 ml · 2:30 pm", "Sleep · 1h 40m", "Diaper · wet") + relative time.
- Detail formatting reuses the per-type summary logic already in `js/home.js`
  (the `e.type === ...` branches around lines 13-19) where possible.

**Interaction:**
- Tap a row → existing `openLog(type, entry)` edit/delete sheet. No new edit UI.
- A **type-filter chip bar** at the top toggles which types are shown (multi-select).
  Filter is session-only (not persisted) for v1.

**Data/scale:** Render from the in-memory log. v1 renders all days; add a lazy
"load more" only if list length becomes a problem. Respects soft-deleted entries
(exclude `deleted_at`).

**States:** empty (no entries yet) and filtered-empty (filters exclude everything)
messages.

**Verification:** Timeline opens from Home; entries grouped by day with correct
summaries; filter chips isolate types; tapping a row edits it; back returns to Home.

---

## Phase 4 — Accounts & OAuth

Self-hosted authentication added to the existing Go server, giving caregivers a durable
identity for multi-device sync/backup and sharing. Anonymous local-first usage remains
fully supported; accounts are opt-in.

### Library & providers

- **`markbates/goth`** (or `coreos/go-oidc` + `golang.org/x/oauth2` if goth proves
  awkward for Apple) inside the existing Go server. No managed third-party service.
- Providers for v1: **Google** and **Apple**.
- OAuth client registration in the Google and Apple developer consoles is a manual
  setup step the project owner performs; credentials supplied via config/env
  (extend `server/config.go`). This is a prerequisite, not code.

### Data model

Build on the existing `families` / `caregivers` / `sessions` schema. Add:

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
caregiver's family). Sessions remain the long-lived cookie mechanism unchanged.

### Endpoints (Go)

- `GET /api/auth/{provider}` — begin the OAuth flow (goth redirect).
- `GET /api/auth/{provider}/callback` — complete the flow, resolve the identity,
  establish/attach a session, and run the reconciliation logic below.
- `POST /api/auth/signout` — delete the current session row (existing revocation model).
- Optionally `GET /api/me` — report signed-in identity for Profile display.

### Reconciliation logic (data-safety critical)

On a successful callback, resolve `(provider, provider_user_id)`:

1. **No existing identity, device has an anonymous family:** *link* — create an
   `identities` row pointing at the current caregiver. The user's existing data is
   preserved and now anchored to their account.
2. **Existing identity, clean device (no local data / fresh family):** *restore* —
   issue a session for the identity's caregiver/family; the existing `/api/sync`
   pulls the family's data down.
3. **Conflict — existing identity points to family B (with data), but the device
   already holds anonymous family A (with data):** *prompt the user* — present three
   choices:
   - **Keep this device's data** (stay on family A; optionally also link the identity
     to A, decided in plan),
   - **Switch to my account** (use family B; family A retained locally as recoverable),
   - **Merge** (fold family A's id-keyed entries into family B with dedupe).

   Never silently discard. Local data is always retained as recoverable until the user
   explicitly chooses. The conflict prompt is a frontend sheet driven by a callback
   response that signals the conflict state rather than auto-committing.

### Frontend

- Sign-in buttons (Google, Apple) in onboarding (`js/onboarding.js`) and Profile
  (`js/profile.js`), styled as rounded pill buttons on-theme.
- Profile shows signed-in state (identity email/provider) and a Sign out action when a
  session is identity-backed.
- A conflict-resolution sheet (Phase 4 reconciliation case 3) reusing the existing
  sheet component.

### Verification

- Fresh anonymous user can sign in and have their existing local data linked (case 1).
- Same identity on a second/clean device restores the family (case 2).
- The conflict case surfaces the prompt and each choice behaves as specified, with no
  data loss (case 3).
- Anonymous-only users are never forced to sign in; the app works unchanged without an
  account.
- Sign out revokes the session.

---

## Out of scope (YAGNI)

- Bath target intervals / reminders.
- Email magic-link and GitHub providers (Google + Apple only for v1).
- Persisted Timeline filters, date-jump, or a Timeline bottom tab.
- A sixth bottom tab.
- Real-time merge-conflict resolution beyond id-keyed dedupe.

## Implementation sequencing

Phases 1–3 are independent of accounts and can ship first (each is small and
self-contained). Phase 4 is the largest and depends on developer-console OAuth app
registration as a prerequisite. The implementation plan should treat each phase — and
within Phase 4, schema → endpoints → reconciliation → frontend — as ordered milestones.

Every phase that changes a cached user-facing asset must bump the version in
`index.html` and `sw.js`.
