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

func TestHandleUpsertGrowthIgnoresCrossFamilyCollision(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?), ('famB', ?)`, nowISO(), nowISO())
	hub := newHub()

	reqA := httptest.NewRequest("PUT", "/api/growth/shared", bytes.NewBufferString(`{"date":"2026-06-20","weightKg":7.3}`))
	reqA.SetPathValue("id", "shared")
	reqA = withSession(reqA, SessionInfo{CaregiverID: "cgA", FamilyID: "famA"})
	handleUpsertGrowth(db, hub)(httptest.NewRecorder(), reqA)

	reqB := httptest.NewRequest("PUT", "/api/growth/shared", bytes.NewBufferString(`{"date":"2026-06-21","weightKg":8.0}`))
	reqB.SetPathValue("id", "shared")
	reqB = withSession(reqB, SessionInfo{CaregiverID: "cgB", FamilyID: "famB"})
	recB := httptest.NewRecorder()
	handleUpsertGrowth(db, hub)(recB, reqB)

	if recB.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", recB.Code)
	}
	var familyID string
	db.QueryRow(`SELECT family_id FROM growth_entries WHERE id = 'shared'`).Scan(&familyID)
	if familyID != "famA" {
		t.Errorf("family_id = %q, want famA (famB's write must be ignored, not overwrite famA's row)", familyID)
	}
}

func TestHandleUpsertGrowthRejectsResurrectingADeletedEntry(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	hub := newHub()

	req1 := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"date":"2026-06-20","weightKg":7.3}`))
	req1.SetPathValue("id", "g1")
	req1 = withSession(req1, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertGrowth(db, hub)(httptest.NewRecorder(), req1)

	del := httptest.NewRequest("DELETE", "/api/growth/g1", nil)
	del.SetPathValue("id", "g1")
	del = withSession(del, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleDeleteGrowth(db, hub)(httptest.NewRecorder(), del)

	req2 := httptest.NewRequest("PUT", "/api/growth/g1", bytes.NewBufferString(`{"date":"2026-06-20","weightKg":7.5}`))
	req2.SetPathValue("id", "g1")
	req2 = withSession(req2, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec2 := httptest.NewRecorder()
	handleUpsertGrowth(db, hub)(rec2, req2)

	if rec2.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec2.Code)
	}
	var deletedAt sql.NullString
	db.QueryRow(`SELECT deleted_at FROM growth_entries WHERE id = 'g1'`).Scan(&deletedAt)
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Error("expected deleted_at to remain set; the stale edit must not resurrect the entry")
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
