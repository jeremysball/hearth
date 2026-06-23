package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateFamily(t *testing.T) {
	db := newTestDB(t)
	body := bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","caregiverName":"Maya"}`)
	req := httptest.NewRequest("POST", "/api/family", body)
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp createFamilyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.FamilyID == "" || resp.BabyID == "" || resp.CaregiverID == "" {
		t.Fatalf("expected non-empty ids, got %+v", resp)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != sessionCookieName {
		t.Fatalf("expected a %s cookie, got %v", sessionCookieName, cookies)
	}
	var babyName string
	if err := db.QueryRow(`SELECT name FROM babies WHERE id = ?`, resp.BabyID).Scan(&babyName); err != nil {
		t.Fatalf("querying baby: %v", err)
	}
	if babyName != "Mira" {
		t.Errorf("babyName = %q, want Mira", babyName)
	}
}

func TestHandleCreateFamilyRejectsMissingBabyName(t *testing.T) {
	db := newTestDB(t)
	req := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
