package server

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func seedFamilyAndBaby(t *testing.T, db *sql.DB, familyID string) {
	t.Helper()
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now)
	db.Exec(`INSERT INTO babies (id, family_id, name, updated_at) VALUES (?, ?, 'Mira', ?)`, newID(), familyID, now)
	db.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, '{}', '{}', '{}', ?)`, familyID, now)
}

func TestHandlePatchBabyUpdatesFields(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","birthdate":"2026-01-15","theme":"boy","photo":""}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var name, theme string
	db.QueryRow(`SELECT name, theme FROM babies WHERE family_id = 'fam1'`).Scan(&name, &theme)
	if name != "Olive" || theme != "boy" {
		t.Errorf("name=%q theme=%q, want Olive/boy", name, theme)
	}
}

func TestHandlePatchBabyNotFoundForUnknownFamily(t *testing.T) {
	db := newParallelTestDB(t)
	hub := newHub()
	req := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive"}`))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "no-such-family"})
	rec := httptest.NewRecorder()

	handlePatchBaby(db, hub)(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestHandlePatchSettingsUpdatesFields(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	body := `{"bottleIntervalH":4,"meds":[{"id":"m1","name":"Vitamin D"}],"units":{"volume":"oz"},"reminders":{"naps":true},"cards":{"bottle":true}}`
	req := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchSettings(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var interval float64
	var unitsJSON string
	db.QueryRow(`SELECT bottle_interval_h, units_json FROM settings WHERE family_id = 'fam1'`).Scan(&interval, &unitsJSON)
	if interval != 4 {
		t.Errorf("bottle_interval_h = %v, want 4", interval)
	}
	if unitsJSON != `{"volume":"oz"}` {
		t.Errorf("units_json = %q, want {\"volume\":\"oz\"}", unitsJSON)
	}
}

func TestHandlePatchSettingsUpdatesPlayTypes(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	body := `{"bottleIntervalH":3,"meds":[],"units":{},"reminders":{},"cards":{},"playTypes":["Tummy time","Reading"]}`
	req := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchSettings(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var playTypesJSON string
	db.QueryRow(`SELECT playtypes_json FROM settings WHERE family_id = 'fam1'`).Scan(&playTypesJSON)
	if playTypesJSON != `["Tummy time","Reading"]` {
		t.Errorf("playtypes_json = %q, want [\"Tummy time\",\"Reading\"]", playTypesJSON)
	}
}

func TestHandlePatchSettingsUpdatesHygiene(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	body := `{"bottleIntervalH":3,"meds":[],"hygiene":[{"id":"h1","name":"Nail trim","everyH":168}],"units":{},"reminders":{},"cards":{},"playTypes":[]}`
	req := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(body))
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handlePatchSettings(db, hub, nil)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var hygieneJSON string
	db.QueryRow(`SELECT hygiene_json FROM settings WHERE family_id = 'fam1'`).Scan(&hygieneJSON)
	if hygieneJSON != `[{"id":"h1","name":"Nail trim","everyH":168}]` {
		t.Errorf("hygiene_json = %q, want [{\"id\":\"h1\",\"name\":\"Nail trim\",\"everyH\":168}]", hygieneJSON)
	}
}
