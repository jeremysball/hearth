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

func handleRedeemLaunchToken(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var caregiverID, familyID, expiresAt string
		err := db.QueryRow(
			`SELECT caregiver_id, family_id, expires_at FROM launch_tokens WHERE token = ?`, token).
			Scan(&caregiverID, &familyID, &expiresAt)
		if err == sql.ErrNoRows {
			http.Error(w, "token not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		expiry, err := time.Parse(time.RFC3339Nano, expiresAt)
		if err != nil || time.Now().UTC().After(expiry) {
			http.Error(w, "token expired", http.StatusGone)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		// Atomically claim the token and create the session in one transaction.
		res, err := tx.Exec(`UPDATE launch_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL`, nowISO(), token)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "token already used", http.StatusGone)
			return
		}

		sessToken, err := createSessionTx(tx, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		log.Printf("launch token redeemed: caregiver=%s family=%s", caregiverID, familyID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
