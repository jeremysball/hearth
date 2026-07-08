package server

// Reproduction tests for the "permanent bidirectional caregiver desync +
// can't invite her back" investigation (2026-07-07). These tests document
// CURRENT behavior of the working tree; where an assertion pins a bug, the
// comment says so. See docs/desync-root-cause.md.
//
// NOTE: the working tree carries uncommitted draft fixes in reconcile.go and
// oauth.go (relink-on-rejoin; a device_family hint + "mismatch" refusal).
// Scenario 1 asserts the relinked (fixed) behavior of the tree. Scenario 2
// still reproduces on the tree because the committed client never sends the
// device_family hint (js/account.js beginSignIn navigates to
// /api/auth/<provider> with no query), so reconcile runs with deviceFamily=""
// and silently restores into the wrong family exactly as before.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// seedFamilyA creates his family with a caregiver and one log entry (so the
// family "has data" for reconcile's conflict check).
func seedFamilyA(t *testing.T, db execer) {
	t.Helper()
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHim','famA','Him','Parent',?)`, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, rev) VALUES ('e1','famA','diaper','t','{"id":"e1"}','cgHim',?,1)`, now)
	db.Exec(`UPDATE families SET rev_counter = 1 WHERE id = 'famA'`)
}

// Scenario 1 — the "removed" identity poison after remove + re-invite.
//
// She was a member of famA with her Google identity linked to that caregiver.
// He removed her, then invited her again; the invite join creates a brand-new
// caregiver and never touches the identity row still pointing at the removed
// caregiver.
//
// COMMITTED behavior (through d23577c): reconcile saw removedAt != "" and
// returned Kind="removed" unconditionally — Google sign-in permanently
// answered "you were removed" to a live member, and if her session was ever
// lost, sign-in (the only recovery path) was dead forever.
//
// WORKING-TREE behavior (uncommitted draft fix in reconcile.go): with a live
// session, the identity is relinked to the live caregiver ("linked"). Without
// a live session it still answers "removed", which is a recoverable dead end
// (a fresh invite works), not silent desync.
func TestInviteRejoinIdentityAfterRemoveAndReinvite(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	seedFamilyA(t, db)

	// Her original caregiver in famA, with her Google identity linked.
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHer1','famA','Her','Partner',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-her','cgHer1','her@x.y',?)`, now)

	// He removes her (same effect as handleRemoveCaregiver).
	db.Exec(`UPDATE caregivers SET removed_at = ? WHERE id = 'cgHer1'`, now)
	db.Exec(`DELETE FROM sessions WHERE caregiver_id = 'cgHer1'`)

	// He creates a fresh invite; she joins through the real handler.
	inviteToken := "invite-rejoin-token"
	expires := time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano)
	db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, 'famA', 'cgHim', ?)`, hashToken(inviteToken), expires)

	req := httptest.NewRequest("POST", "/api/join/"+inviteToken, strings.NewReader(`{"caregiverName":"Her"}`))
	req.SetPathValue("token", inviteToken)
	rec := httptest.NewRecorder()
	handleJoinInvite(db)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("join failed: %d %s", rec.Code, rec.Body.String())
	}

	// Find her new caregiver row (the live one).
	var newCare string
	if err := db.QueryRow(`SELECT id FROM caregivers WHERE family_id='famA' AND display_name='Her' AND removed_at=''`).Scan(&newCare); err != nil {
		t.Fatalf("new caregiver not found: %v", err)
	}

	// She taps "Continue with Google" on that same phone (live session for
	// the NEW caregiver). Her identity row still points at the removed one.
	cur := &SessionInfo{CaregiverID: newCare, FamilyID: "famA"}
	res, err := reconcile(db, "google", "sub-her", "her@x.y", cur, "")
	if err != nil {
		t.Fatal(err)
	}

	// Working-tree (draft-fixed) behavior: relink to the live caregiver.
	// If this returns "removed", the committed identity poison is back.
	if res.Kind != "linked" || res.CaregiverID != newCare {
		t.Fatalf("expected relink to live caregiver %s, got %+v (Kind=removed here means the committed identity-poison bug is live)", newCare, res)
	}
	var identCare string
	db.QueryRow(`SELECT caregiver_id FROM identities WHERE provider='google' AND provider_user_id='sub-her'`).Scan(&identCare)
	if identCare != newCare {
		t.Fatalf("identity still bound to %s, want %s", identCare, newCare)
	}

	// The remaining sharp edge, still true on the tree: if her session dies
	// BEFORE she signs in again, the answer is "removed" — a hard stop with a
	// clear message (recoverable via a fresh invite), not a silent desync.
	res2, err := reconcile(db, "google", "sub-her2", "her2@x.y", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res2.Kind != "signedup" {
		// unrelated identity sanity check only
		t.Fatalf("fresh identity should sign up, got %+v", res2)
	}
}

// Scenario 2 — the silent family split. STILL LIVE END-TO-END.
//
// Her Google identity points at her own solo family famB (created by a
// "signedup" reconcile before she ever joined famA — e.g. she tapped Continue
// with Google once in a context with no session cookie; joining famA via
// invite later overwrote her session cookie but left the identity row on
// famB). Her famA session dies (session row gone → silent 401s on every
// sync). She taps "Continue with Google" to fix it.
//
// The uncommitted reconcile.go draft can refuse with "mismatch" — but only
// when the callback receives a device_family hint, and the committed client
// never sends one (js/account.js:33 navigates to /api/auth/<provider> with no
// query, so oauth.go never sets the hint cookie). With deviceFamily == ""
// reconcile silently restores her into famB: her phone still shows all of
// famA's data locally and looks normal, every write lands in famB, every pull
// returns famB. Permanent, bidirectional, error-free desync — and her queued
// (401-retained) outbox ops drain into famB too.
func TestOAuthRestoreAfterSessionLossSilentlySplitsFamilies(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	seedFamilyA(t, db)

	// Her live membership in famA (via invite), NO identity linked to it.
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHerA','famA','Her','Partner',?)`, now)

	// Her solo family famB from an earlier Google signup; identity → famB.
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHerB','famB','Parent','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-her','cgHerB','her@x.y',?)`, now)

	// Her famA session is gone (silent-401 state): cookie no longer matches
	// any session row, so handleAuthCallback passes cur == nil. The committed
	// client sends no device_family hint, so it arrives as "".
	res, err := reconcile(db, "google", "sub-her", "her@x.y", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" {
		t.Fatalf("expected restored, got %+v", res)
	}
	// CURRENT behavior: she lands in famB, not famA where her partner is.
	if res.FamilyID != "famB" {
		t.Fatalf("expected the silent split into famB, got %+v", res)
	}

	// Her next write goes to famB via the real entries handler.
	tok, err := createSession(db, res.CaregiverID, res.FamilyID)
	if err != nil {
		t.Fatal(err)
	}
	_ = tok
	req := httptest.NewRequest("PUT", "/api/entries/e2", strings.NewReader(`{"id":"e2","type":"feed","start":"2026-07-07T10:00:00Z"}`))
	req.SetPathValue("id", "e2")
	req = withSession(req, SessionInfo{CaregiverID: res.CaregiverID, FamilyID: res.FamilyID})
	rec := httptest.NewRecorder()
	handleUpsertEntry(db, newHub(), nil)(rec, req)
	if rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
		t.Fatalf("upsert failed: %d %s", rec.Code, rec.Body.String())
	}
	var fam string
	db.QueryRow(`SELECT family_id FROM log_entries WHERE id='e2'`).Scan(&fam)
	if fam != "famB" {
		t.Fatalf("entry landed in %s", fam)
	}
	// And his famA pull never sees it; her famB pull never sees his e1.
	var nHis, nHers int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='famA' AND id='e2'`).Scan(&nHis)
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='famB' AND id='e1'`).Scan(&nHers)
	if nHis != 0 || nHers != 0 {
		t.Fatalf("families unexpectedly share entries: his=%d hers=%d", nHis, nHers)
	}

	// The draft server fix DOES catch this — but only once the client sends
	// the device_family hint through the OAuth flow. Documented here so the
	// fix isn't shipped server-side only and declared done.
	resHint, err := reconcile(db, "google", "sub-her", "her@x.y", nil, "famA")
	if err != nil {
		t.Fatal(err)
	}
	if resHint.Kind != "mismatch" {
		t.Fatalf("with a device_family hint the draft fix should refuse with mismatch, got %+v", resHint)
	}
	t.Logf("PROVEN: without the (not-yet-sent) device_family hint, session loss + Google sign-in silently splits her into famB")
}

// Scenario 3 — "Merge into my account" moves rows the partner can never pull.
//
// mergeFamilies (server/resolve.go) re-homes log/growth rows by rewriting
// family_id ONLY. The moved rows keep the rev values they earned from the
// SOURCE family's rev_counter; nothing bumps the TARGET family's rev_counter
// or restamps the rows, and no SSE broadcast fires. Every device already in
// the target family holds a sync cursor at the target's rev_counter, so its
// incremental pull (WHERE rev > since) skips any moved row whose old rev is
// at or below that watermark — permanently, because the cursor only ratchets
// upward and the rows are never rewritten. The merging device looks fine (it
// has the data locally); the partner silently never receives the merged
// history. This violates ADR 0003's invariant that every sync-visible row
// change is stamped from the target family's counter in the same tx.
func TestMergeFamiliesMovesRowsBelowPartnersCursor(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()

	// Target family famT: partner has logged 5 entries through the real
	// handler, so rev_counter = 5 and the partner's cursor after a pull is 5.
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famT', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgPartner','famT','Partner','Parent',?)`, now)
	for i := 1; i <= 5; i++ {
		id := fmt.Sprintf("t%d", i)
		req := httptest.NewRequest("PUT", "/api/entries/"+id, strings.NewReader(fmt.Sprintf(`{"id":%q,"type":"feed","start":"2026-07-07T0%d:00:00Z"}`, id, i)))
		req.SetPathValue("id", id)
		req = withSession(req, SessionInfo{CaregiverID: "cgPartner", FamilyID: "famT"})
		rec := httptest.NewRecorder()
		handleUpsertEntry(db, newHub(), nil)(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("seed upsert %s: %d %s", id, rec.Code, rec.Body.String())
		}
	}
	partnerCursor := pullServerRev(t, "cgPartner", "famT", -1) // full pull → cursor = 5
	if partnerCursor != 5 {
		t.Fatalf("expected partner cursor 5, got %d", partnerCursor)
	}

	// Source family famS: her solo device family with 3 entries, revs 1..3
	// earned from famS's own counter.
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famS', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHer','famS','Her','Parent',?)`, now)
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("s%d", i)
		db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, rev) VALUES (?,?,?,?,?,?,?,?)`,
			id, "famS", "feed", "t", fmt.Sprintf(`{"id":%q}`, id), "cgHer", now, i)
	}
	db.Exec(`UPDATE families SET rev_counter = 3 WHERE id = 'famS'`)

	// The partner has an open SSE connection at merge time; the merge must
	// push a live update, not just leave it for the next poll.
	hub := newHub()
	sseCh, cancel := hub.Subscribe("famT")
	defer cancel()

	// She resolves the OAuth conflict with "Merge into my account".
	if err := mergeFamilies(db, hub, "famS", "famT"); err != nil {
		t.Fatal(err)
	}

	select {
	case <-sseCh:
	default:
		t.Fatal("expected mergeFamilies to broadcast to the target family's SSE subscribers")
	}

	// The rows are in famT now…
	var moved int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='famT' AND id LIKE 's%'`).Scan(&moved)
	if moved != 3 {
		t.Fatalf("expected 3 moved rows, got %d", moved)
	}

	// mergeFamilies now re-revs every moved row from famT's own counter, so
	// the partner's incremental pull at cursor 5 DOES deliver them, and
	// serverRev advances past 5.
	got := pullEntryIDs(t, "cgPartner", "famT", partnerCursor)
	for _, id := range []string{"s1", "s2", "s3"} {
		if !got[id] {
			t.Fatalf("partner's incremental pull did not deliver merged row %s", id)
		}
	}
	if rev := pullServerRev(t, "cgPartner", "famT", partnerCursor); rev <= 5 {
		t.Fatalf("expected serverRev to advance past 5 after the merge re-revved 3 rows, got %d", rev)
	}

	// A full resync (since=-1) still delivers them too.
	full := pullEntryIDs(t, "cgPartner", "famT", -1)
	for _, id := range []string{"s1", "s2", "s3"} {
		if !full[id] {
			t.Fatalf("full resync missing %s: merge lost the row entirely", id)
		}
	}
	t.Logf("PROVEN: merged rows are re-revved from the target family's counter, so the partner's incremental pull delivers them")
}

// pullServerRev runs a real handleSync pull and returns the serverRev the
// client would store as its next cursor.
func pullServerRev(t *testing.T, caregiverID, familyID string, since int64) int64 {
	t.Helper()
	resp := doPull(t, caregiverID, familyID, since)
	return resp.ServerRev
}

// pullEntryIDs runs a real handleSync pull and returns the set of entry ids
// the client would merge.
func pullEntryIDs(t *testing.T, caregiverID, familyID string, since int64) map[string]bool {
	t.Helper()
	resp := doPull(t, caregiverID, familyID, since)
	ids := map[string]bool{}
	for _, raw := range resp.Entries {
		var e struct {
			ID string `json:"id"`
		}
		json.Unmarshal(raw, &e)
		ids[e.ID] = true
	}
	return ids
}

func doPull(t *testing.T, caregiverID, familyID string, since int64) syncResponse {
	t.Helper()
	req := httptest.NewRequest("GET", fmt.Sprintf("/api/sync?since=%d", since), nil)
	req = withSession(req, SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})
	rec := httptest.NewRecorder()
	handleSync(testDBState.db)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("sync pull failed: %d %s", rec.Code, rec.Body.String())
	}
	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode sync response: %v", err)
	}
	return resp
}
