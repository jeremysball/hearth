package main

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
		_, err = db.Exec(`
			INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				type = excluded.type, start = excluded.start, payload_json = excluded.payload_json,
				updated_at = excluded.updated_at, deleted_at = NULL
			WHERE log_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Type, meta.Start, string(bodyBytes), session.CaregiverID, now)
		if err != nil {
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
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		now := nowISO()
		res, err := db.Exec(`UPDATE log_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
			now, now, id, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
