package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type caregiverInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Photo       string `json:"photo"`
}

func handleListCaregivers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		rows, err := db.Query(`SELECT id, display_name, role, photo FROM caregivers WHERE family_id = ? ORDER BY created_at`, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []caregiverInfo{}
		for rows.Next() {
			var c caregiverInfo
			if err := rows.Scan(&c.ID, &c.DisplayName, &c.Role, &c.Photo); err != nil {
				continue
			}
			list = append(list, c)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	}
}

func handlePatchCurrentCaregiver(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		var body struct {
			Photo string `json:"photo"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		res, err := db.Exec(`UPDATE caregivers SET photo = ?, updated_at = ? WHERE id = ? AND family_id = ?`, body.Photo, nowISO(), session.CaregiverID, session.FamilyID)
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
