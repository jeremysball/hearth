# Family Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-caregiver admin status, admin-only role changes, soft removal, and a crown marker in Settings.

**Architecture:** Keep the permission model derived: the first active caregiver by `created_at` is admin. Store removed caregivers with `removed_at` so old log attribution survives. Enforce all permissions in Go handlers; the JS UI only reflects allowed actions.

**Tech Stack:** Go HTTP server + SQLite, vanilla JS PWA, existing delegated `data-action` event handling, existing Profile caregiver list.

## Global Constraints

- Add no framework.
- Preserve historical attribution for removed caregivers.
- Settings shows active caregivers only.
- Backend enforces admin-only role changes and removals.
- Run `scripts/bump-version.sh` for frontend changes.

---

### Task 1: Backend Caregiver Admin Model

**Files:**
- Modify: `server/schema.sql`
- Modify: `server/db.go`
- Modify: `server/auth.go`
- Modify: `server/caregivers.go`
- Modify: `server/router.go`
- Test: `server/caregivers_test.go`

**Interfaces:**
- Produces: `caregiverInfo.IsAdmin bool`, `caregiverInfo.RemovedAt string`
- Produces: `isFamilyAdmin(db, familyID, caregiverID string) (bool, error)`
- Produces: `PATCH /api/caregivers/{id}/role` with `{"role":"Parent"}`
- Produces: `DELETE /api/caregivers/{id}` soft-removes a caregiver

- [ ] Add `removed_at TEXT NOT NULL DEFAULT ''` to the caregiver schema and startup column check.
- [ ] Change auth lookup to join caregivers and reject removed caregivers.
- [ ] Update caregiver listing to support `includeRemoved=1`, mark only the first active caregiver as admin, and include `removedAt`.
- [ ] Add admin-only role update and soft-delete handlers.
- [ ] Register the new routes.
- [ ] Add Go tests for admin derivation, removed filtering, role updates, permission denial, self-removal denial, session revocation, and auth rejection.
- [ ] Run `cd server && go test ./...`.
- [ ] Commit backend work.

### Task 2: Settings UI And Client Actions

**Files:**
- Modify: `js/profile.js`
- Modify: `js/app.js`
- Modify: `styles.css`
- Modify: `js/changelog.js`
- Modify: `index.html`
- Modify: `sw.js`
- Test: browser-focused tests if cheap; otherwise verify with checks and server tests.

**Interfaces:**
- Consumes: `caregiverInfo.isAdmin`, `caregiverInfo.removedAt`
- Produces: `cg:role` delegated action
- Produces: `cg:remove` delegated action

- [ ] Render crown styling for admin caregiver avatars.
- [ ] Render role selector and remove button only when current caregiver is admin and target row is not admin.
- [ ] Add delegated handlers that call the role and remove endpoints, reload caregivers, refresh Profile, and show toasts.
- [ ] Confirm removal before calling DELETE.
- [ ] Load caregiver attribution with `includeRemoved=1` while filtering Settings to active caregivers.
- [ ] Add changelog text for family management.
- [ ] Run `scripts/bump-version.sh`.
- [ ] Run focused JS checks and relevant Playwright tests.
- [ ] Commit frontend work.

### Task 3: PR And Review

**Files:**
- No source edits unless review finds a bug.

- [ ] Run final verification: `npm run check`, `node --test js/*.test.js`, `cd server && go test ./...`, and focused Playwright tests.
- [ ] Push `feat/family-admin-crown`.
- [ ] Open PR with summary and verification.
- [ ] Run GLM 5.2 review on the PR diff.
- [ ] Fix valid findings, verify, commit, push, and update PR.
