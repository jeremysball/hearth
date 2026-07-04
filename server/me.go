package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

func handleMe(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var provider, email string
		err := db.QueryRow(`SELECT provider, COALESCE(email,'') FROM identities WHERE caregiver_id = ? LIMIT 1`, session.CaregiverID).
			Scan(&provider, &email)
		w.Header().Set("Content-Type", "application/json")
		if err == sql.ErrNoRows {
			w.Write([]byte(`{"identity":null}`))
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"identity": map[string]string{"provider": provider, "email": email},
		})
	}
}

func handleSignout(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		if c, err := r.Cookie(sessionCookieName); err == nil {
			if matchedHash, err := lookupByToken(db, `SELECT token_hash FROM sessions WHERE token_hash IN (%s)`, c.Value); err == nil {
				db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, matchedHash)
			}
		}
		logAuthEvent(r, "signout", session)
		http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Path: "/", MaxAge: -1})
		w.WriteHeader(http.StatusNoContent)
	}
}
