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
}

func handleListCaregivers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		rows, err := db.Query(`SELECT id, display_name, role FROM caregivers WHERE family_id = ? ORDER BY created_at`, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []caregiverInfo{}
		for rows.Next() {
			var c caregiverInfo
			if err := rows.Scan(&c.ID, &c.DisplayName, &c.Role); err != nil {
				continue
			}
			list = append(list, c)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	}
}
