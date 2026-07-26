package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Moved entries land in B under a FRESH id, not A's original id. The
// original row stays in A (tombstoned — see TestMergeFamiliesTombstonesOriginalInSource)
// so a device still on A can learn it's gone; A's id can't be reused in B
// because log_entries.id is a single global primary key, not per-family.
func TestMergeFamiliesCopiesEntriesUnderNewIds(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1','B','sleep','t','{}','cgB',?),('b2','B','bath','t','{}','cgB',?)`, now, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1','A','feed','t','{"id":"a1"}','cgA',?)`, now)
	if err := mergeFamilies(db, newHub(), "A", "B"); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='B' AND deleted_at IS NULL`).Scan(&n)
	if n != 3 { // b1, b2, plus a1's content copied under a new id
		t.Fatalf("family B live entry count = %d, want 3", n)
	}
	var id, typ, payload string
	if err := db.QueryRow(`SELECT id, type, payload_json FROM log_entries WHERE family_id='B' AND type='feed'`).Scan(&id, &typ, &payload); err != nil {
		t.Fatal(err)
	}
	if id == "a1" {
		t.Fatal("expected the copied entry to get a fresh id, not reuse A's original id")
	}
	if !strings.Contains(payload, id) {
		t.Errorf("payload_json = %q, expected it to embed the new id %q so future edits/deletes target the right row", payload, id)
	}
	// A's original row must still exist (tombstoned, not deleted outright) —
	// asserted in detail by TestMergeFamiliesTombstonesOriginalInSource.
	var deletedAt sql.NullString
	if err := db.QueryRow(`SELECT deleted_at FROM log_entries WHERE id='a1'`).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected A's original row (id=a1) to remain, tombstoned")
	}
}

// A device or caregiver that stays on the SOURCE family after a merge must
// learn its entries moved, via the same tombstone mechanism normal deletes
// already use — not just have them vanish with no signal, which is exactly
// what left partners permanently unable to tell their shared data had moved.
func TestMergeFamiliesTombstonesOriginalInSource(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famS', ?), ('famT', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgHer','famS','Her','Parent',?),('cgPartner','famS','Partner','Partner',?)`, now, now)

	req := httptest.NewRequest("PUT", "/api/entries/s1", strings.NewReader(`{"id":"s1","type":"feed","start":"2026-07-07T09:00:00Z"}`))
	req.SetPathValue("id", "s1")
	req = withSession(req, SessionInfo{CaregiverID: "cgHer", FamilyID: "famS"})
	rec := httptest.NewRecorder()
	handleUpsertEntry(db, newHub(), nil)(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("seed upsert: %d %s", rec.Code, rec.Body.String())
	}
	partnerCursor := pullServerRev(t, "cgPartner", "famS", -1)

	if err := mergeFamilies(db, newHub(), "famS", "famT"); err != nil {
		t.Fatal(err)
	}

	// The partner, still on famS, pulls incrementally — same as any normal
	// sync tick, nothing tells them a merge happened.
	resp := doPull(t, "cgPartner", "famS", partnerCursor)
	var sawTombstone bool
	for _, raw := range resp.Entries {
		var e struct {
			ID        string `json:"id"`
			DeletedAt string `json:"deletedAt"`
		}
		if err := json.Unmarshal(raw, &e); err != nil {
			t.Fatal(err)
		}
		if e.ID == "s1" {
			sawTombstone = true
			if e.DeletedAt == "" {
				t.Errorf("expected s1 to arrive as a tombstone, got %+v", e)
			}
		}
	}
	if !sawTombstone {
		t.Fatal("expected the partner's incremental pull on famS to include a tombstone for the moved entry s1")
	}
}

// If session creation fails after mergeFamilies already committed, the
// entries are stuck in the target family but the user's browser keeps its
// old cookie pointing at the now-empty source family — invisible data,
// nobody can reach it. The merge and the session must commit atomically.
func TestResolveMergeRollsBackIfSessionCreationFails(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1','A','feed','t','{"id":"a1"}','cgA',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub','cgB','e',?)`, now)
	db.Exec(`INSERT INTO pending_auth (token_hash, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES (?,'google','sub','e','B','A','cgA',?)`,
		hashForTest(t, "p"), now)

	if _, err := db.Exec(`DROP TABLE sessions`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Exec(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, caregiver_id TEXT NOT NULL REFERENCES caregivers(id), family_id TEXT NOT NULL REFERENCES families(id), created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`)
	})

	req := httptest.NewRequest("POST", "/api/auth/resolve", strings.NewReader(`{"pending":"p","choice":"merge"}`))
	rec := httptest.NewRecorder()
	handleResolve(db, newHub())(rec, req)

	if rec.Code == http.StatusNoContent {
		t.Fatalf("expected resolve to fail when session creation fails, got 204")
	}
	// The entry must still be in A, untouched — not moved to B with no way
	// for anyone to reach it.
	var familyID string
	if err := db.QueryRow(`SELECT family_id FROM log_entries WHERE id='a1'`).Scan(&familyID); err != nil {
		t.Fatal(err)
	}
	if familyID != "A" {
		t.Fatalf("expected a1 to remain in A when the merge rolled back, got family_id=%q", familyID)
	}
	var pendingCount int
	db.QueryRow(`SELECT COUNT(*) FROM pending_auth WHERE token_hash = ?`, hashForTest(t, "p")).Scan(&pendingCount)
	if pendingCount == 0 {
		t.Fatal("expected the pending_auth row to remain so the user can retry")
	}
}

func TestResolveSwitchIssuesSessionForTarget(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub','cgB','e',?)`, now)
	db.Exec(`INSERT INTO pending_auth (token_hash, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES (?,'google','sub','e','B','A','cgA',?)`,
		hashForTest(t, "p"), now)
	req := httptest.NewRequest("POST", "/api/auth/resolve", strings.NewReader(`{"pending":"p","choice":"switch"}`))
	rec := httptest.NewRecorder()
	handleResolve(db, newHub())(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE family_id='B'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 session for B, got %d", n)
	}
	db.QueryRow(`SELECT COUNT(*) FROM pending_auth WHERE token_hash = ?`, hashForTest(t, "p")).Scan(&n)
	if n != 0 {
		t.Fatalf("pending row not cleared")
	}
}
