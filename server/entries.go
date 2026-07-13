package server

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
)

func handleUpsertEntry(db *sql.DB, hub *Hub, pushes *pushScheduler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		if id == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var meta struct {
			Type  string `json:"type"`
			Start string `json:"start"`
		}
		if err := json.Unmarshal(bodyBytes, &meta); err != nil || meta.Type == "" || meta.Start == "" {
			http.Error(w, "type and start are required", http.StatusBadRequest)
			return
		}
		now := nowISO()
		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()
		rev, err := bumpRev(tx, session.FamilyID)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		_, err = tx.Exec(`
			INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				type = excluded.type, start = excluded.start, payload_json = excluded.payload_json,
				updated_at = excluded.updated_at, rev = excluded.rev, deleted_at = NULL
			WHERE log_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Type, meta.Start, string(bodyBytes), session.CaregiverID, now, rev)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		if pushes != nil {
			pushes.ScheduleFamily(session.FamilyID)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteEntry(db *sql.DB, hub *Hub) http.HandlerFunc {
	return handleSoftDelete(db, hub, "log_entries")
}
