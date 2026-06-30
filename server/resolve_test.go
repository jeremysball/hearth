package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMergeFamiliesCopiesEntries(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	// A has a1; B has b1, b2. All ids unique across the table (PK constraint).
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1','B','sleep','t','{}','cgB',?),('b2','B','bath','t','{}','cgB',?)`, now, now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('a1','A','feed','t','{}','cgA',?)`, now)
	if err := mergeFamilies(db, "A", "B"); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id='B'`).Scan(&n)
	if n != 3 { // b1, b2, plus a1 copied from A
		t.Fatalf("family B entry count = %d, want 3", n)
	}
	// a1 should now belong to B
	var typ string
	db.QueryRow(`SELECT type FROM log_entries WHERE family_id='B' AND id='a1'`).Scan(&typ)
	if typ != "feed" {
		t.Fatalf("a1 type = %q, want 'feed'", typ)
	}
}

func TestMergeFamiliesDedupesById(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	// B has an entry with id x1. A tries to insert same id — dedup should keep B's.
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('x1','B','sleep','t','{}','cgB',?)`, now)
	// Can't insert x1 into A (PK conflict). Merge is a no-op but should not error.
	if err := mergeFamilies(db, "A", "B"); err != nil {
		t.Fatal(err)
	}
	var typ string
	db.QueryRow(`SELECT type FROM log_entries WHERE id='x1'`).Scan(&typ)
	if typ != "sleep" {
		t.Fatalf("x1 type = %q, want kept 'sleep'", typ)
	}
}

func TestResolveSwitchIssuesSessionForTarget(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('A', ?), ('B', ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','A','A','Parent',?),('cgB','B','B','Parent',?)`, now, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub','cgB','e',?)`, now)
	db.Exec(`INSERT INTO pending_auth (token, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES ('p','google','sub','e','B','A','cgA',?)`, now)
	req := httptest.NewRequest("POST", "/api/auth/resolve", strings.NewReader(`{"pending":"p","choice":"switch"}`))
	rec := httptest.NewRecorder()
	handleResolve(db)(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE family_id='B'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 session for B, got %d", n)
	}
	db.QueryRow(`SELECT COUNT(*) FROM pending_auth WHERE token='p'`).Scan(&n)
	if n != 0 {
		t.Fatalf("pending row not cleared")
	}
}
