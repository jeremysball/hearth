package server

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// mergeFamilies moves every live log_entries/growth_entries row from `from`
// into `to`, then commits and broadcasts to both. See mergeFamiliesTx for
// the actual per-row logic; this wrapper exists for callers (and tests) that
// don't need the merge atomic with anything else. handleResolve's "merge"
// choice instead calls mergeFamiliesTx directly inside its own transaction,
// so the merge and the new session commit or fail together.
func mergeFamilies(db *sql.DB, hub *Hub, from, to string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := mergeFamiliesTx(tx, from, to); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	hub.Broadcast(from)
	hub.Broadcast(to)
	return nil
}

func mergeFamiliesTx(tx *sql.Tx, from, to string) error {
	if err := mergeLogEntries(tx, from, to); err != nil {
		return err
	}
	if err := mergeGrowthEntries(tx, from, to); err != nil {
		return err
	}
	return nil
}

// mergeLogEntries re-creates every live (non-deleted) row from `from` under
// a fresh id in `to`, stamped with a rev from `to`'s own counter (ADR 0003:
// a row's rev must come from the counter of the family it currently lives
// in), and tombstones the original in place under `from` with a rev from
// `from`'s counter.
//
// A row can't just have its family_id rewritten in place (the previous
// approach): log_entries.id is one global primary key, not scoped per
// family, so the same id can't simultaneously exist as a live row in `to`
// and a tombstone in `from` — and a tombstone under the ORIGINAL id in
// `from` is exactly what a caregiver who stays on `from` (a device that
// doesn't follow the merge, or another member of a shared source family)
// needs: without it, their next incremental sync just never mentions the
// row again, and their local copy never learns it's gone. See
// TestMergeFamiliesTombstonesOriginalInSource.
//
// payload_json's embedded "id" field is rewritten to the new id too — the
// client trusts that field (not the DB column) for the id it uses in later
// PUT/DELETE requests, so leaving it stale would make the copied entry
// unreachable for edits.
func mergeLogEntries(tx *sql.Tx, from, to string) error {
	rows, err := tx.Query(`SELECT id, type, start, payload_json, created_by, updated_at FROM log_entries WHERE family_id = ? AND deleted_at IS NULL`, from)
	if err != nil {
		return err
	}
	type entry struct {
		id, typ, start, payload, createdBy, updatedAt string
	}
	var moved []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.typ, &e.start, &e.payload, &e.createdBy, &e.updatedAt); err != nil {
			rows.Close()
			return err
		}
		moved = append(moved, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for _, e := range moved {
		newRowID := newID()
		fromRev, err := bumpRev(tx, from)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE log_entries SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ?`,
			e.updatedAt, e.updatedAt, fromRev, e.id); err != nil {
			return err
		}
		toRev, err := bumpRev(tx, to)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			newRowID, to, e.typ, e.start, rewritePayloadID(e.payload, newRowID), e.createdBy, e.updatedAt, toRev); err != nil {
			return err
		}
	}
	return nil
}

// rewritePayloadID sets payload's top-level "id" field to newRowID. Falls
// back to the original payload if it's not a JSON object (shouldn't happen —
// handleUpsertEntry always stores the validated request body — but a
// malformed row must not abort the whole merge).
func rewritePayloadID(payload, newRowID string) string {
	var obj map[string]any
	if err := json.Unmarshal([]byte(payload), &obj); err != nil {
		return payload
	}
	obj["id"] = newRowID
	b, err := json.Marshal(obj)
	if err != nil {
		return payload
	}
	return string(b)
}

// mergeGrowthEntries mirrors mergeLogEntries. Growth rows have no JSON
// payload carrying its own id (the sync response builds one from columns),
// so there's no embedded id to rewrite.
func mergeGrowthEntries(tx *sql.Tx, from, to string) error {
	rows, err := tx.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, updated_at FROM growth_entries WHERE family_id = ? AND deleted_at IS NULL`, from)
	if err != nil {
		return err
	}
	type entry struct {
		id, date, updatedAt        string
		weightKg, heightCm, headCm sql.NullFloat64
		note                       sql.NullString
	}
	var moved []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.date, &e.weightKg, &e.heightCm, &e.headCm, &e.note, &e.updatedAt); err != nil {
			rows.Close()
			return err
		}
		moved = append(moved, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for _, e := range moved {
		newRowID := newID()
		fromRev, err := bumpRev(tx, from)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE growth_entries SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ?`,
			e.updatedAt, e.updatedAt, fromRev, e.id); err != nil {
			return err
		}
		toRev, err := bumpRev(tx, to)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			newRowID, to, e.date, e.weightKg, e.heightCm, e.headCm, e.note, e.updatedAt, toRev); err != nil {
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

		switch req.Choice {
		case "keep":
			db.Exec(`DELETE FROM pending_auth WHERE token_hash = ?`, matchedHash)
			w.WriteHeader(http.StatusNoContent)
		case "merge", "switch":
			// One transaction for the merge (if any), the identity lookup,
			// the new session, and consuming the pending_auth row: if any
			// step fails, everything rolls back instead of leaving the data
			// moved with no session to reach it, or a session issued with
			// pending_auth still consumable for a second, redundant merge.
			tx, err := db.Begin()
			if err != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			committed := false
			defer func() {
				if !committed {
					tx.Rollback()
				}
			}()
			if req.Choice == "merge" {
				if err := mergeFamiliesTx(tx, current, target); err != nil {
					http.Error(w, "merge failed", http.StatusInternalServerError)
					return
				}
			}
			var careB string
			if err := tx.QueryRow(`SELECT caregiver_id FROM identities WHERE provider=? AND provider_user_id=?`, provider, providerUserID).Scan(&careB); err != nil {
				http.Error(w, "identity vanished", http.StatusInternalServerError)
				return
			}
			tok, err := createSession(tx, careB, target)
			if err != nil {
				http.Error(w, "session failed", http.StatusInternalServerError)
				return
			}
			if _, err := tx.Exec(`DELETE FROM pending_auth WHERE token_hash = ?`, matchedHash); err != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			if err := tx.Commit(); err != nil {
				http.Error(w, "database error", http.StatusInternalServerError)
				return
			}
			committed = true
			if req.Choice == "merge" {
				hub.Broadcast(current)
			}
			hub.Broadcast(target)
			setSessionCookie(w, tok)
			logAuthEvent(r, "oauth_resolve_"+req.Choice, SessionInfo{CaregiverID: careB, FamilyID: target})
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unknown choice", http.StatusBadRequest)
		}
	}
}
