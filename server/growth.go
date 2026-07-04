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
			INSERT INTO growth_entries (id, family_id, date, weight_kg, height_cm, head_cm, note, updated_at, rev)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				date = excluded.date, weight_kg = excluded.weight_kg, height_cm = excluded.height_cm,
				head_cm = excluded.head_cm, note = excluded.note, updated_at = excluded.updated_at, rev = excluded.rev, deleted_at = NULL
			WHERE growth_entries.family_id = excluded.family_id`,
			id, session.FamilyID, meta.Date, meta.WeightKg, meta.HeightCm, meta.HeadCm, meta.Note, now, rev)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
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
		res, err := tx.Exec(`UPDATE growth_entries SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ? AND family_id = ?`,
			now, now, rev, id, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
}
