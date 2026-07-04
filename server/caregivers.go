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
	IsAdmin     bool   `json:"isAdmin"`
	RemovedAt   string `json:"removedAt"`
}

var allowedCaregiverRoles = map[string]bool{"Parent": true, "Partner": true, "Caregiver": true}

func isFamilyAdmin(db *sql.DB, familyID, caregiverID string) (bool, error) {
	var adminID string
	err := db.QueryRow(`SELECT id FROM caregivers WHERE family_id = ? AND removed_at = '' ORDER BY created_at LIMIT 1`, familyID).Scan(&adminID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return adminID == caregiverID, nil
}

func handleListCaregivers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		includeRemoved := r.URL.Query().Get("includeRemoved") == "1"
		query := `SELECT id, display_name, role, photo, removed_at FROM caregivers WHERE family_id = ? AND removed_at = '' ORDER BY created_at`
		if includeRemoved {
			query = `SELECT id, display_name, role, photo, removed_at FROM caregivers WHERE family_id = ? ORDER BY created_at`
		}
		rows, err := db.Query(query, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		list := []caregiverInfo{}
		adminMarked := false
		for rows.Next() {
			var c caregiverInfo
			if err := rows.Scan(&c.ID, &c.DisplayName, &c.Role, &c.Photo, &c.RemovedAt); err != nil {
				continue
			}
			if !adminMarked && c.RemovedAt == "" {
				c.IsAdmin = true
				adminMarked = true
			}
			list = append(list, c)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	}
}

func handlePatchCaregiverRole(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		ok, err := isFamilyAdmin(db, session.FamilyID, session.CaregiverID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		targetID := r.PathValue("id")
		if targetID == session.CaregiverID {
			http.Error(w, "cannot change own role", http.StatusForbidden)
			return
		}
		var body struct {
			Role string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		if !allowedCaregiverRoles[body.Role] {
			http.Error(w, "invalid role", http.StatusBadRequest)
			return
		}
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
		res, err := tx.Exec(`UPDATE caregivers SET role = ?, updated_at = ?, rev = ? WHERE id = ? AND family_id = ? AND removed_at = ''`, body.Role, nowISO(), rev, targetID, session.FamilyID)
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

func handleRemoveCaregiver(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		ok, err := isFamilyAdmin(db, session.FamilyID, session.CaregiverID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		targetID := r.PathValue("id")
		if targetID == session.CaregiverID {
			http.Error(w, "cannot remove yourself", http.StatusForbidden)
			return
		}
		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()
		now := nowISO()
		rev, err := bumpRev(tx, session.FamilyID)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		res, err := tx.Exec(`UPDATE caregivers SET removed_at = ?, updated_at = ?, rev = ? WHERE id = ? AND family_id = ? AND removed_at = ''`, now, now, rev, targetID, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if _, err := tx.Exec(`DELETE FROM sessions WHERE caregiver_id = ? AND family_id = ?`, targetID, session.FamilyID); err != nil {
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
		res, err := tx.Exec(`UPDATE caregivers SET photo = ?, updated_at = ?, rev = ? WHERE id = ? AND family_id = ?`, body.Photo, nowISO(), rev, session.CaregiverID, session.FamilyID)
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
