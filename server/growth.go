package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
)

func handleUpsertGrowth(db *sql.DB, hub *Hub) http.HandlerFunc {
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
			Date     string   `json:"date"`
			WeightKg *float64 `json:"weightKg"`
			HeightCm *float64 `json:"heightCm"`
			HeadCm   *float64 `json:"headCm"`
			Note     string   `json:"note"`
		}
		if err := json.Unmarshal(bodyBytes, &meta); err != nil || meta.Date == "" {
			http.Error(w, "date is required", http.StatusBadRequest)
			return
		}
		now := nowISO()
		_, err = db.Exec(`
			INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				date = excluded.date, weight_kg = excluded.weight_kg, height_cm = excluded.height_cm,
				head_cm = excluded.head_cm, note = excluded.note, updated_at = excluded.updated_at, deleted_at = NULL
			WHERE growth_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Date, meta.WeightKg, meta.HeightCm, meta.HeadCm, meta.Note, now)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteGrowth(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		now := nowISO()
		res, err := db.Exec(`UPDATE growth_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
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
