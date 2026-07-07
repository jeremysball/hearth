package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// mergeFamilies moves every log_entries/growth_entries row from `from` into
// `to`. Each moved row is re-stamped with a fresh rev from the TARGET
// family's counter (ADR 0003's per-family rev invariant: a row's rev must
// come from the counter of the family it currently lives in) so the
// partner's next incremental pull (`rev > cursor`) actually delivers it,
// instead of the row silently keeping a rev the partner's cursor already
// passed. hub.Broadcast(to) after commit pushes it over SSE too.
func mergeFamilies(db *sql.DB, hub *Hub, from, to string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := mergeLogEntries(tx, from, to); err != nil {
		return err
	}
	if err := mergeGrowthEntries(tx, from, to); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	hub.Broadcast(to)
	return nil
}

func mergeLogEntries(tx *sql.Tx, from, to string) error {
	rows, err := tx.Query(`SELECT id, type, start, payload_json, created_by, updated_at, deleted_at FROM log_entries WHERE family_id = ?`, from)
	if err != nil {
		return err
	}
	type entry struct {
		id, typ, start, payload, createdBy, updatedAt string
		deletedAt                                      sql.NullString
	}
	var moved []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.typ, &e.start, &e.payload, &e.createdBy, &e.updatedAt, &e.deletedAt); err != nil {
			rows.Close()
			return err
		}
		moved = append(moved, e)
	}
	rows.Close()

	for _, e := range moved {
		rev, err := bumpRev(tx, to)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, deleted_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id, rev = excluded.rev`,
			e.id, to, e.typ, e.start, e.payload, e.createdBy, e.updatedAt, e.deletedAt, rev); err != nil {
			return err
		}
	}
	return nil
}

func mergeGrowthEntries(tx *sql.Tx, from, to string) error {
	rows, err := tx.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at FROM growth_entries WHERE family_id = ?`, from)
	if err != nil {
		return err
	}
	type entry struct {
		id, date, updatedAt        string
		weightKg, heightCm, headCm sql.NullFloat64
		note, deletedAt            sql.NullString
	}
	var moved []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.date, &e.weightKg, &e.heightCm, &e.headCm, &e.note, &e.updatedAt, &e.deletedAt); err != nil {
			rows.Close()
			return err
		}
		moved = append(moved, e)
	}
	rows.Close()

	for _, e := range moved {
		rev, err := bumpRev(tx, to)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at, deleted_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id, rev = excluded.rev`,
			e.id, to, e.date, e.weightKg, e.heightCm, e.headCm, e.note, e.updatedAt, e.deletedAt, rev); err != nil {
			return err
		}
	}
	return nil
}

type resolveRequest struct {
	Pending string `json:"pending"`
	Choice  string `json:"choice"`
}

func handleConflictInfo(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("pending")
		var provider, email, target, current string
		_, err := lookupByToken(db, `
			SELECT token_hash, provider, COALESCE(email,''), target_family_id, current_family_id
			FROM pending_auth WHERE token_hash IN (%s)`, token, &provider, &email, &target, &current)
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

func handleResolve(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req resolveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		var provider, providerUserID, email, target, current, currentCare string
		matchedHash, err := lookupByToken(db, `
			SELECT token_hash, provider, provider_user_id, COALESCE(email,''), target_family_id, current_family_id, current_caregiver_id
			FROM pending_auth WHERE token_hash IN (%s)`, req.Pending, &provider, &providerUserID, &email, &target, &current, &currentCare)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		finish := func() { db.Exec(`DELETE FROM pending_auth WHERE token_hash = ?`, matchedHash) }

		switch req.Choice {
		case "keep":
			finish()
			w.WriteHeader(http.StatusNoContent)
		case "merge":
			if err := mergeFamilies(db, hub, current, target); err != nil {
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
