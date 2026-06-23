package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleListCaregiversReturnsFamilyMembers(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?)`, nowISO())

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleListCaregivers(db)(rec, req)

	var list []caregiverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 caregivers, got %d", len(list))
	}
}

func TestHandleListCaregiversOnlyReturnsOwnFamily(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?), ('famB', ?)`, nowISO(), nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA', 'famA', 'Maya', 'Parent', ?)`, nowISO())
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB', 'famB', 'Someone Else', 'Parent', ?)`, nowISO())

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cgA", FamilyID: "famA"})
	rec := httptest.NewRecorder()

	handleListCaregivers(db)(rec, req)

	var list []caregiverInfo
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].DisplayName != "Maya" {
		t.Fatalf("expected only famA's caregiver, got %+v", list)
	}
}
