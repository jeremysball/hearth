package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

func mergeFamilies(db *sql.DB, from, to string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Move entries from `from` family to `to` family by updating family_id.
	// ON CONFLICT DO UPDATE is required because INSERT … SELECT from the same
	// table rejects every source row as a PK conflict (do-nothing would skip all).
	if _, err := tx.Exec(`
		INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, deleted_at)
		SELECT id, ?, type, start, payload_json, created_by, updated_at, deleted_at
		FROM log_entries WHERE family_id = ?
		ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id`, to, from); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at)
		SELECT id, ?, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at
		FROM growth_entries WHERE family_id = ?
		ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id`, to, from); err != nil {
		return err
	}
	return tx.Commit()
}

type resolveRequest struct {
	Pending string `json:"pending"`
	Choice  string `json:"choice"`
}

func handleConflictInfo(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("pending")
		var provider, email, target, current string
		err := db.QueryRow(`SELECT provider, COALESCE(email,''), target_family_id, current_family_id FROM pending_auth WHERE token = ?`, token).
			Scan(&provider, &email, &target, &current)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"provider": provider, "email": email,
			"current": familySummary(db, current),
			"target":  familySummary(db, target),
		})
	}
}

func familySummary(db *sql.DB, familyID string) map[string]any {
	var name string
	var count int
	db.QueryRow(`SELECT b.name, COUNT(le.id) FROM babies b LEFT JOIN log_entries le ON le.family_id = b.family_id AND le.deleted_at IS NULL WHERE b.family_id = ? GROUP BY b.id`, familyID).Scan(&name, &count)
	return map[string]any{"familyId": familyID, "babyName": name, "entryCount": count}
}

func handleResolve(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req resolveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		var provider, providerUserID, email, target, current, currentCare string
		err := db.QueryRow(`SELECT provider, provider_user_id, COALESCE(email,''), target_family_id, current_family_id, current_caregiver_id FROM pending_auth WHERE token = ?`, req.Pending).
			Scan(&provider, &providerUserID, &email, &target, &current, &currentCare)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		finish := func() { db.Exec(`DELETE FROM pending_auth WHERE token = ?`, req.Pending) }

		switch req.Choice {
		case "keep":
			finish()
			w.WriteHeader(http.StatusNoContent)
		case "merge":
			if err := mergeFamilies(db, current, target); err != nil {
				http.Error(w, "merge failed", http.StatusInternalServerError)
				return
			}
			fallthrough
		case "switch":
			var careB string
			if err := db.QueryRow(`SELECT caregiver_id FROM identities WHERE provider=? AND provider_user_id=?`, provider, providerUserID).Scan(&careB); err != nil {
				http.Error(w, "identity vanished", http.StatusInternalServerError)
				return
			}
			tok, err := createSession(db, careB, target)
			if err != nil {
				http.Error(w, "session failed", http.StatusInternalServerError)
				return
			}
			setSessionCookie(w, tok)
			logAuthEvent(r, "oauth_resolve_"+req.Choice, SessionInfo{CaregiverID: careB, FamilyID: target})
			finish()
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unknown choice", http.StatusBadRequest)
		}
	}
}
