package server

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleUpsertEntryCreates(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertEntry(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var typ string
	if err := db.QueryRow(`SELECT type FROM log_entries WHERE id = 'e1'`).Scan(&typ); err != nil {
		t.Fatal(err)
	}
	if typ != "sleep" {
		t.Errorf("type = %q, want sleep", typ)
	}
}

func TestHandleUpsertEntryUpdatesExisting(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req1 := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	req1.SetPathValue("id", "e1")
	req1 = withSession(req1, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), req1)

	req2 := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z","end":"2026-06-23T11:00:00Z"}`))
	req2.SetPathValue("id", "e1")
	req2 = withSession(req2, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), req2)

	var payload string
	db.QueryRow(`SELECT payload_json FROM log_entries WHERE id = 'e1'`).Scan(&payload)
	if !strings.Contains(payload, "11:00:00") {
		t.Errorf("payload_json = %q, expected it to contain the updated end time", payload)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM log_entries WHERE id = 'e1'`).Scan(&count)
	if count != 1 {
		t.Fatalf("expected exactly 1 row for id e1, got %d", count)
	}
}

func TestHandleUpsertEntryIgnoresCrossFamilyCollision(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?), ('famB', ?)`, nowISO(), nowISO())
	hub := newHub()

	reqA := httptest.NewRequest("PUT", "/api/entries/shared", bytes.NewBufferString(`{"type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqA.SetPathValue("id", "shared")
	reqA = withSession(reqA, SessionInfo{CaregiverID: "cgA", FamilyID: "famA"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqA)

	reqB := httptest.NewRequest("PUT", "/api/entries/shared", bytes.NewBufferString(`{"type":"feed","start":"2026-06-23T12:00:00Z"}`))
	reqB.SetPathValue("id", "shared")
	reqB = withSession(reqB, SessionInfo{CaregiverID: "cgB", FamilyID: "famB"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqB)

	var familyID string
	db.QueryRow(`SELECT family_id FROM log_entries WHERE id = 'shared'`).Scan(&familyID)
	if familyID != "famA" {
		t.Errorf("family_id = %q, want famA (famB's write must be ignored, not overwrite famA's row)", familyID)
	}
}

func TestHandleUpsertEntryRejectsMissingType(t *testing.T) {
	db := newParallelTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"start":"2026-06-23T10:00:00Z"}`))
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertEntry(db, hub, nil)(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteEntrySoftDeletes(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()
	now := nowISO()
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1', 'fam1', 'sleep', ?, '{}', 'cg1', ?)`, now, now)

	req := httptest.NewRequest("DELETE", "/api/entries/e1", nil)
	req.SetPathValue("id", "e1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteEntry(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var deletedAt sql.NullString
	db.QueryRow(`SELECT deleted_at FROM log_entries WHERE id = 'e1'`).Scan(&deletedAt)
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected deleted_at to be set")
	}
}

func TestHandleDeleteEntryNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("DELETE", "/api/entries/nope", nil)
	req.SetPathValue("id", "nope")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteEntry(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
