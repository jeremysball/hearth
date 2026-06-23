package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
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
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
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
		defaultUnits := `{"volume":"ml","temp":"C","weight":"kg","length":"cm"}`
		defaultReminders := `{"naps":true,"bottle":true,"meds":true,"quietStart":"20:00","quietEnd":"07:00"}`
		defaultCards := `{"sweetspot":true,"bottle":true,"medicine":true}`
		if _, err := tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			familyID, defaultUnits, defaultReminders, defaultCards, now); err != nil {
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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createFamilyResponse{FamilyID: familyID, BabyID: babyID, CaregiverID: caregiverID})
	}
}
