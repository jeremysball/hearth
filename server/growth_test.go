package server

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleUpsertGrowthCreates(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"date":"2026-06-20","weightKg":7.3,"heightCm":67}`))
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var weight float64
	if err := db.QueryRow(`SELECT weight_kg FROM growth_entries WHERE id = 'g1'`).Scan(&weight); err != nil {
		t.Fatal(err)
	}
	if weight != 7.3 {
		t.Errorf("weight_kg = %v, want 7.3", weight)
	}
}

func TestHandleUpsertGrowthRejectsMissingDate(t *testing.T) {
	db := newParallelTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"weightKg":7.3}`))
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleUpsertGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestHandleDeleteGrowthSoftDeletes(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()
	now := nowISO()
	db.Exec(`INSERT INTO growth_entries (id, family_id, date, weight_kg, updated_at) VALUES ('g1', 'fam1', '2026-06-20', 7.3, ?)`, now)

	req := httptest.NewRequest("DELETE", "/api/growth/g1", nil)
	req.SetPathValue("id", "g1")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var deletedAt sql.NullString
	db.QueryRow(`SELECT deleted_at FROM growth_entries WHERE id = 'g1'`).Scan(&deletedAt)
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected deleted_at to be set")
	}
}

func TestHandleDeleteGrowthNotFound(t *testing.T) {
	db := newParallelTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("DELETE", "/api/growth/nope", nil)
	req.SetPathValue("id", "nope")
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleDeleteGrowth(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
