package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleDevJoinReturns404WhenDevModeDisabled(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())

	req := httptest.NewRequest("POST", "/api/dev/join", nil)
	rec := httptest.NewRecorder()

	handleDevJoin(db, newHub(), Config{DevMode: false})(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when DevMode is disabled", rec.Code)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM caregivers WHERE family_id = 'fam1'`).Scan(&count)
	if count != 0 {
		t.Fatalf("expected no caregiver created when DevMode is disabled, got %d", count)
	}
}

func TestHandleDevJoinCreatesCaregiverAndSession(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())

	req := httptest.NewRequest("POST", "/api/dev/join", nil)
	rec := httptest.NewRecorder()

	handleDevJoin(db, newHub(), Config{DevMode: true})(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("expected a %s cookie, got %v", sessionCookieName, cookies)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM caregivers WHERE family_id = 'fam1'`).Scan(&count)
	if count != 1 {
		t.Fatalf("expected exactly 1 caregiver created, got %d", count)
	}
}

func TestHandleDevJoinReturns404WithNoFamilyYet(t *testing.T) {
	db := newParallelTestDB(t)

	req := httptest.NewRequest("POST", "/api/dev/join", nil)
	rec := httptest.NewRecorder()

	handleDevJoin(db, newHub(), Config{DevMode: true})(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when no family exists yet", rec.Code)
	}
}
