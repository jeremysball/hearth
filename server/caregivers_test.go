package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleListCaregiversReturnsFamilyMembers(t *testing.T) {
	db := newParallelTestDB(t)
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
	db := newParallelTestDB(t)
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

func TestHandleListCaregiversIncludesPhoto(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', 'data:image/jpeg;base64,abc', ?, ?)`, now, now)

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleListCaregivers(db)(rec, req)

	var list []caregiverInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	if len(list) != 1 || list[0].Photo != "data:image/jpeg;base64,abc" {
		t.Fatalf("expected caregiver photo in response, got %+v", list)
	}
}

func TestHandlePatchCurrentCaregiverPhotoUpdatesOnlySessionCaregiver(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', '', ?, ?)`, now, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', '', ?, ?)`, now, now)

	req := httptest.NewRequest("PATCH", "/api/caregivers/me", bytes.NewBufferString(`{"photo":"data:image/jpeg;base64,new"}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchCurrentCaregiver(db, newHub())(rec, req)
	if rec.Code != 204 {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}

	var ownPhoto, otherPhoto string
	db.QueryRow(`SELECT photo FROM caregivers WHERE id = 'cg1'`).Scan(&ownPhoto)
	db.QueryRow(`SELECT photo FROM caregivers WHERE id = 'cg2'`).Scan(&otherPhoto)
	if ownPhoto != "data:image/jpeg;base64,new" || otherPhoto != "" {
		t.Fatalf("photos = own %q other %q", ownPhoto, otherPhoto)
	}
}
