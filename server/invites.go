package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

const inviteTTL = 48 * time.Hour

type createInviteResponse struct {
	Token string `json:"token"`
}

func handleCreateInvite(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(inviteTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(`INSERT INTO invites (token, family_id, created_by, expires_at) VALUES (?, ?, ?, ?)`,
			token, session.FamilyID, session.CaregiverID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createInviteResponse{Token: token})
	}
}

type joinInviteRequest struct {
	CaregiverName string `json:"caregiverName"`
}

type joinInviteResponse struct {
	FamilyID    string `json:"familyId"`
	CaregiverID string `json:"caregiverId"`
}

func handleJoinInvite(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var familyID string
		var expiresAt string
		var usedAt sql.NullString
		err := db.QueryRow(`SELECT family_id, expires_at, used_at FROM invites WHERE token = ?`, token).
			Scan(&familyID, &expiresAt, &usedAt)
		if err == sql.ErrNoRows {
			http.Error(w, "invite not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if usedAt.Valid && usedAt.String != "" {
			http.Error(w, "invite already used", http.StatusGone)
			return
		}
		expiry, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "invite expired", http.StatusGone)
			return
		}

		var req joinInviteRequest
		json.NewDecoder(r.Body).Decode(&req) // best-effort; empty name falls back below
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Caregiver"
		}

		caregiverID := newID()
		now := nowISO()
		if _, err := db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, ?, 'Partner', ?)`,
			caregiverID, familyID, caregiverName, now); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := db.Exec(`UPDATE invites SET used_at = ? WHERE token = ?`, now, token); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		sessToken, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(joinInviteResponse{FamilyID: familyID, CaregiverID: caregiverID})
	}
}
