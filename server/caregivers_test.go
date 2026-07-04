package server

import (
	"bytes"
	"encoding/json"
	"net/http"
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
	if !list[0].IsAdmin || list[1].IsAdmin {
		t.Fatalf("admin flags = %+v, want first caregiver only", list)
	}
}

func TestHandleListCaregiversFiltersRemovedUnlessRequested(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, removed_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, '2026-01-01T00:00:00Z', '')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, removed_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?, '2026-01-02T00:00:00Z', ?)`, now, now)

	req := httptest.NewRequest("GET", "/api/caregivers", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handleListCaregivers(db)(rec, req)
	var active []caregiverInfo
	json.Unmarshal(rec.Body.Bytes(), &active)
	if len(active) != 1 || active[0].ID != "cg1" {
		t.Fatalf("active caregivers = %+v", active)
	}

	req = httptest.NewRequest("GET", "/api/caregivers?includeRemoved=1", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec = httptest.NewRecorder()
	handleListCaregivers(db)(rec, req)
	var all []caregiverInfo
	json.Unmarshal(rec.Body.Bytes(), &all)
	if len(all) != 2 || all[1].RemovedAt == "" || all[1].IsAdmin {
		t.Fatalf("all caregivers = %+v", all)
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

func TestHandlePatchCaregiverRoleRequiresAdminAndUpdatesRole(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('admin', 'fam1', 'Maya', 'Parent', '', ?, '2026-01-01T00:00:00Z')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', '', ?, '2026-01-02T00:00:00Z')`, now)

	req := httptest.NewRequest("PATCH", "/api/caregivers/cg2/role", bytes.NewBufferString(`{"role":"Caregiver"}`))
	req.SetPathValue("id", "cg2")
	req = withSession(req, SessionInfo{CaregiverID: "admin", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handlePatchCaregiverRole(db, newHub())(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("admin role status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var role string
	db.QueryRow(`SELECT role FROM caregivers WHERE id = 'cg2'`).Scan(&role)
	if role != "Caregiver" {
		t.Fatalf("role = %q, want Caregiver", role)
	}

	req = httptest.NewRequest("PATCH", "/api/caregivers/admin/role", bytes.NewBufferString(`{"role":"Caregiver"}`))
	req.SetPathValue("id", "admin")
	req = withSession(req, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec = httptest.NewRecorder()
	handlePatchCaregiverRole(db, newHub())(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin role status = %d, want 403", rec.Code)
	}
}

func TestHandlePatchCaregiverRoleRejectsInvalidRoleAndSelfChange(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('admin', 'fam1', 'Maya', 'Parent', ?, '2026-01-01T00:00:00Z')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?, '2026-01-02T00:00:00Z')`, now)

	req := httptest.NewRequest("PATCH", "/api/caregivers/cg2/role", bytes.NewBufferString(`{"role":"Admin"}`))
	req.SetPathValue("id", "cg2")
	req = withSession(req, SessionInfo{CaregiverID: "admin", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handlePatchCaregiverRole(db, newHub())(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid role status = %d, want 400", rec.Code)
	}

	req = httptest.NewRequest("PATCH", "/api/caregivers/admin/role", bytes.NewBufferString(`{"role":"Partner"}`))
	req.SetPathValue("id", "admin")
	req = withSession(req, SessionInfo{CaregiverID: "admin", FamilyID: "fam1"})
	rec = httptest.NewRecorder()
	handlePatchCaregiverRole(db, newHub())(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("self role status = %d, want 403", rec.Code)
	}
}

func TestHandleRemoveCaregiverSoftRemovesAndRevokesSessions(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('admin', 'fam1', 'Maya', 'Parent', ?, '2026-01-01T00:00:00Z')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?, '2026-01-02T00:00:00Z')`, now)
	db.Exec(`INSERT INTO sessions (token_hash, caregiver_id, family_id, created_at, last_seen_at) VALUES (?, 'cg2', 'fam1', ?, ?)`, hashForTest(t, "tok2"), now, now)

	req := httptest.NewRequest("DELETE", "/api/caregivers/cg2", nil)
	req.SetPathValue("id", "cg2")
	req = withSession(req, SessionInfo{CaregiverID: "admin", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handleRemoveCaregiver(db, newHub())(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remove status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var removedAt string
	db.QueryRow(`SELECT removed_at FROM caregivers WHERE id = 'cg2'`).Scan(&removedAt)
	if removedAt == "" {
		t.Fatal("expected removed_at to be set")
	}
	var sessions int
	db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE caregiver_id = 'cg2'`).Scan(&sessions)
	if sessions != 0 {
		t.Fatalf("sessions = %d, want 0", sessions)
	}
	var name string
	db.QueryRow(`SELECT display_name FROM caregivers WHERE id = 'cg2'`).Scan(&name)
	if name != "Dad" {
		t.Fatalf("historical caregiver row missing, name=%q", name)
	}
}

func TestHandleRemoveCaregiverRejectsNonAdminAndSelf(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('admin', 'fam1', 'Maya', 'Parent', ?, '2026-01-01T00:00:00Z')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', ?, '2026-01-02T00:00:00Z')`, now)

	req := httptest.NewRequest("DELETE", "/api/caregivers/admin", nil)
	req.SetPathValue("id", "admin")
	req = withSession(req, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handleRemoveCaregiver(db, newHub())(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin remove status = %d, want 403", rec.Code)
	}

	req = httptest.NewRequest("DELETE", "/api/caregivers/admin", nil)
	req.SetPathValue("id", "admin")
	req = withSession(req, SessionInfo{CaregiverID: "admin", FamilyID: "fam1"})
	rec = httptest.NewRecorder()
	handleRemoveCaregiver(db, newHub())(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("self remove status = %d, want 403", rec.Code)
	}
}

func TestRequireAuthRejectsRemovedCaregiverSession(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, removed_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?, ?, ?)`, now, now, now)
	db.Exec(`INSERT INTO sessions (token_hash, caregiver_id, family_id, created_at, last_seen_at) VALUES (?, 'cg1', 'fam1', ?, ?)`, hashForTest(t, "tok1"), now, now)

	req := httptest.NewRequest("GET", "/api/me", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "tok1"})
	rec := httptest.NewRecorder()
	reached := false
	requireAuth(db, func(w http.ResponseWriter, r *http.Request) { reached = true })(rec, req)
	if reached || rec.Code != http.StatusUnauthorized {
		t.Fatalf("removed session reached=%v status=%d, want 401 without handler", reached, rec.Code)
	}
}
