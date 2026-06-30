package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
)

const (
	defaultUnitsJSON     = `{"volume":"ml","temp":"C","weight":"kg","length":"cm"}`
	defaultRemindersJSON = `{"naps":true,"bottle":true,"meds":true,"quietStart":"20:00","quietEnd":"07:00"}`
	defaultCardsJSON     = `{"sweetspot":true,"bottle":true,"medicine":true,"order":["sweetspot","bottle","medicine"]}`
)

type createFamilyRequest struct {
	BabyName      string `json:"babyName"`
	Birthdate     string `json:"birthdate"`
	Theme         string `json:"theme"`
	CaregiverName string `json:"caregiverName"`
}

type createFamilyResponse struct {
	FamilyID    string `json:"familyId"`
	BabyID      string `json:"babyId"`
	CaregiverID string `json:"caregiverId"`
}

func handleCreateFamily(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createFamilyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if req.BabyName == "" {
			http.Error(w, "babyName is required", http.StatusBadRequest)
			return
		}
		theme := req.Theme
		if theme == "" {
			theme = "girl"
		}
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Parent"
		}

		familyID, babyID, caregiverID := newID(), newID(), newID()
		now := nowISO()

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if _, err := tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, familyID, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			babyID, familyID, req.BabyName, req.Birthdate, theme, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, ?, 'Parent', ?)`,
			caregiverID, familyID, caregiverName, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			familyID, defaultUnitsJSON, defaultRemindersJSON, defaultCardsJSON, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		token, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, token)
		log.Printf("family created: baby=%q caregiver=%q family=%s", req.BabyName, caregiverName, familyID)
		logAuthEvent(r, "signup", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createFamilyResponse{FamilyID: familyID, BabyID: babyID, CaregiverID: caregiverID})
	}
}

type patchBabyRequest struct {
	Name      string `json:"name"`
	Birthdate string `json:"birthdate"`
	Theme     string `json:"theme"`
	Photo     string `json:"photo"`
}

func handlePatchBaby(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var req patchBabyRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		now := nowISO()
		res, err := db.Exec(`UPDATE babies SET name = ?, birthdate = ?, theme = ?, photo = ?, updated_at = ? WHERE family_id = ?`,
			req.Name, req.Birthdate, req.Theme, req.Photo, now, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "baby not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}

type patchSettingsRequest struct {
	BottleIntervalH float64         `json:"bottleIntervalH"`
	Meds            json.RawMessage `json:"meds"`
	Units           json.RawMessage `json:"units"`
	Reminders       json.RawMessage `json:"reminders"`
	Cards           json.RawMessage `json:"cards"`
}

func rawOrNull(r json.RawMessage) string {
	if len(r) == 0 {
		return "null"
	}
	return string(r)
}

func handlePatchSettings(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var req patchSettingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		now := nowISO()
		res, err := db.Exec(`UPDATE settings SET bottle_interval_h = ?, meds_json = ?, units_json = ?, reminders_json = ?, cards_json = ?, updated_at = ? WHERE family_id = ?`,
			req.BottleIntervalH, rawOrNull(req.Meds), rawOrNull(req.Units), rawOrNull(req.Reminders), rawOrNull(req.Cards), now, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "settings not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
