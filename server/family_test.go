package server

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleCreateFamily(t *testing.T) {
	db := newParallelTestDB(t)
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

func TestHandleCreateFamilyStoresSex(t *testing.T) {
	db := newParallelTestDB(t)
	body := bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","sex":"girl","caregiverName":"Maya"}`)
	req := httptest.NewRequest("POST", "/api/family", body)
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var sex string
	if err := db.QueryRow(`SELECT sex FROM babies`).Scan(&sex); err != nil {
		t.Fatalf("querying baby: %v", err)
	}
	if sex != "girl" {
		t.Errorf("sex = %q, want girl", sex)
	}
}

// If session creation fails after the family/baby/caregiver/settings rows
// already committed, signup is stuck: the DB shows a fully provisioned
// family but the browser never gets a session cookie, and the second-family
// guard now blocks ever retrying. createSession must run in the same
// transaction as provisioning.
func TestHandleCreateFamilyRollsBackIfSessionCreationFails(t *testing.T) {
	db := newParallelTestDB(t)

	if _, err := db.Exec(`DROP TABLE sessions`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Exec(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, caregiver_id TEXT NOT NULL REFERENCES caregivers(id), family_id TEXT NOT NULL REFERENCES families(id), created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`)
	})

	req := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","caregiverName":"Maya"}`))
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code == 200 {
		t.Fatalf("expected create-family to fail when session creation fails, got 200")
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM families`).Scan(&count)
	if count != 0 {
		t.Fatalf("expected no family to be committed when session creation failed, got %d (provisioned with no way to sign in)", count)
	}
}

func TestHandleCreateFamilyRejectsMissingBabyName(t *testing.T) {
	db := newParallelTestDB(t)
	req := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()

	handleCreateFamily(db)(rec, req)

	if rec.Code != 400 {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestStatusReportsUnprovisionedThenProvisioned(t *testing.T) {
	db := newParallelTestDB(t)

	rec := httptest.NewRecorder()
	handleStatus(db, Config{})(rec, httptest.NewRequest("GET", "/api/status", nil))
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp.Provisioned {
		t.Fatalf("expected provisioned = false on an empty DB")
	}

	createReq := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{"babyName":"Mira"}`))
	createRec := httptest.NewRecorder()
	handleCreateFamily(db)(createRec, createReq)
	if createRec.Code != 200 {
		t.Fatalf("setup family create status = %d, body = %s", createRec.Code, createRec.Body.String())
	}

	rec2 := httptest.NewRecorder()
	handleStatus(db, Config{})(rec2, httptest.NewRequest("GET", "/api/status", nil))
	var resp2 statusResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !resp2.Provisioned {
		t.Fatalf("expected provisioned = true after a family was created")
	}
}

func TestStatusReportsDevModeFromConfig(t *testing.T) {
	db := newParallelTestDB(t)

	rec := httptest.NewRecorder()
	handleStatus(db, Config{DevMode: true})(rec, httptest.NewRequest("GET", "/api/status", nil))
	var resp statusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !resp.DevMode {
		t.Fatalf("expected devMode = true when Config.DevMode is set")
	}

	rec2 := httptest.NewRecorder()
	handleStatus(db, Config{})(rec2, httptest.NewRequest("GET", "/api/status", nil))
	var resp2 statusResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if resp2.DevMode {
		t.Fatalf("expected devMode = false by default")
	}
}

func TestCreateFamilyRejectsSecondFamily(t *testing.T) {
	db := newParallelTestDB(t)

	firstReq := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{"babyName":"Mira","birthdate":"2026-01-01","theme":"girl","caregiverName":"Maya"}`))
	firstRec := httptest.NewRecorder()
	handleCreateFamily(db)(firstRec, firstReq)
	if firstRec.Code != 200 {
		t.Fatalf("first create status = %d, body = %s", firstRec.Code, firstRec.Body.String())
	}

	secondReq := httptest.NewRequest("POST", "/api/family", bytes.NewBufferString(`{"babyName":"Otis","birthdate":"2026-02-02","theme":"boy","caregiverName":"Sam"}`))
	secondRec := httptest.NewRecorder()
	handleCreateFamily(db)(secondRec, secondReq)
	if secondRec.Code != 409 {
		t.Fatalf("second create status = %d, want 409, body = %s", secondRec.Code, secondRec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM families`).Scan(&count); err != nil {
		t.Fatalf("querying families: %v", err)
	}
	if count != 1 {
		t.Fatalf("families count = %d, want 1", count)
	}
	var babyName string
	if err := db.QueryRow(`SELECT name FROM babies WHERE family_id = (SELECT id FROM families LIMIT 1)`).Scan(&babyName); err != nil {
		t.Fatalf("querying baby: %v", err)
	}
	if babyName != "Mira" {
		t.Fatalf("babyName = %q, want Mira (first family's data untouched)", babyName)
	}
}
