package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

const launchTokenTTL = 10 * time.Minute

type createLaunchTokenResponse struct {
	Token string `json:"token"`
}

func handleCreateLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(launchTokenTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(
			`INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at) VALUES (?, ?, ?, ?)`,
			token, session.CaregiverID, session.FamilyID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		log.Printf("launch token created: caregiver=%s family=%s", session.CaregiverID, session.FamilyID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createLaunchTokenResponse{Token: token})
	}
}
