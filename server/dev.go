package server

import (
	"database/sql"
	"log"
	"net/http"
)

// handleDevJoin lets a fresh device join the instance's sole existing family
// as a new caregiver, with no invite token and no OAuth round trip. Only
// reachable when DEV_MODE=true — every real deployment must go through a
// real invite or OAuth sign-in instead.
func handleDevJoin(db *sql.DB, hub *Hub, cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !cfg.DevMode {
			http.Error(w, "dev mode not enabled", http.StatusNotFound)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		var familyID string
		if err := tx.QueryRow(`SELECT id FROM families LIMIT 1`).Scan(&familyID); err == sql.ErrNoRows {
			http.Error(w, "no family provisioned yet", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		caregiverID := newID()
		now := nowISO()
		rev, err := bumpRev(tx, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, rev) VALUES (?, ?, 'Dev Caregiver', 'Partner', ?, ?, ?)`,
			caregiverID, familyID, now, now, rev); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		// createSession runs in the same transaction as the caregiver insert:
		// if it fails, the whole join rolls back instead of leaving a
		// caregiver row with no way to sign in.
		sessToken, err := createSession(tx, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		hub.Broadcast(familyID)
		log.Printf("dev caregiver joined: family=%s", familyID)
		logAuthEvent(r, "dev_join", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})
		w.WriteHeader(http.StatusNoContent)
	}
}
