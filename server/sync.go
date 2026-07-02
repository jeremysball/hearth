package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type syncResponse struct {
	ServerTime         string            `json:"serverTime"`
	Baby               json.RawMessage   `json:"baby,omitempty"`
	Settings           json.RawMessage   `json:"settings,omitempty"`
	Entries            []json.RawMessage `json:"entries"`
	Growth             []json.RawMessage `json:"growth"`
	Caregivers         []json.RawMessage `json:"caregivers"`
	CurrentCaregiverID string            `json:"currentCaregiverId"`
}

func handleSync(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		since := r.URL.Query().Get("since")
		lowerBound := syncLowerBound(since)

		resp := syncResponse{ServerTime: nowISO(), Entries: []json.RawMessage{}, Growth: []json.RawMessage{}, Caregivers: []json.RawMessage{}, CurrentCaregiverID: session.CaregiverID}

		var name, birthdate, theme string
		var photo sql.NullString
		var babyUpdatedAt string
		err := db.QueryRow(`SELECT name, birthdate, theme, photo, updated_at FROM babies WHERE family_id = ?`, session.FamilyID).
			Scan(&name, &birthdate, &theme, &photo, &babyUpdatedAt)
		if err == nil && changedAfter(babyUpdatedAt, since) {
			b, _ := json.Marshal(map[string]any{"name": name, "birthdate": birthdate, "theme": theme, "photo": photo.String})
			resp.Baby = b
		}

		var bottleIntervalH float64
		var medsJSON, unitsJSON, remindersJSON, cardsJSON, playTypesJSON, settingsUpdatedAt string
		err = db.QueryRow(`SELECT bottle_interval_h, meds_json, units_json, reminders_json, cards_json, playtypes_json, updated_at FROM settings WHERE family_id = ?`, session.FamilyID).
			Scan(&bottleIntervalH, &medsJSON, &unitsJSON, &remindersJSON, &cardsJSON, &playTypesJSON, &settingsUpdatedAt)
		if err == nil && changedAfter(settingsUpdatedAt, since) {
			s, _ := json.Marshal(map[string]any{
				"bottleIntervalH": bottleIntervalH,
				"meds":            json.RawMessage(medsJSON),
				"units":           json.RawMessage(unitsJSON),
				"reminders":       json.RawMessage(remindersJSON),
				"cards":           json.RawMessage(cardsJSON),
				"playTypes":       json.RawMessage(playTypesJSON),
			})
			resp.Settings = s
		}

		adminID := ""
		db.QueryRow(`SELECT id FROM caregivers WHERE family_id = ? AND removed_at = '' ORDER BY created_at LIMIT 1`, session.FamilyID).Scan(&adminID)
		caregiverRows, err := db.Query(`SELECT id, display_name, role, photo, updated_at, removed_at FROM caregivers WHERE family_id = ? AND updated_at > ? ORDER BY created_at`, session.FamilyID, lowerBound)
		if err == nil {
			defer caregiverRows.Close()
			for caregiverRows.Next() {
				var id, displayName, role, photo, updatedAt, removedAt string
				if err := caregiverRows.Scan(&id, &displayName, &role, &photo, &updatedAt, &removedAt); err != nil {
					log.Printf("sync: scan caregivers family=%s: %v", session.FamilyID, err)
					continue
				}
				if !changedAfter(updatedAt, since) {
					continue
				}
				b, _ := json.Marshal(caregiverInfo{ID: id, DisplayName: displayName, Role: role, Photo: photo, RemovedAt: removedAt, IsAdmin: removedAt == "" && id == adminID})
				resp.Caregivers = append(resp.Caregivers, b)
			}
		}

		rows, err := db.Query(`SELECT payload_json, created_by, deleted_at, updated_at FROM log_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, lowerBound)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var payload, createdBy, updatedAt string
				var deletedAt sql.NullString
				if err := rows.Scan(&payload, &createdBy, &deletedAt, &updatedAt); err != nil {
					log.Printf("sync: scan log_entries family=%s: %v", session.FamilyID, err)
					continue
				}
				if !changedAfter(updatedAt, since) {
					continue
				}
				resp.Entries = append(resp.Entries, tombstoneOrPayload(payload, deletedAt, createdBy))
			}
		}

		grows, err := db.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, deleted_at, updated_at FROM growth_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, lowerBound)
		if err == nil {
			defer grows.Close()
			for grows.Next() {
				var id, date, updatedAt string
				var weightKg, heightCm, headCm sql.NullFloat64
				var note, deletedAt sql.NullString
				if err := grows.Scan(&id, &date, &weightKg, &heightCm, &headCm, &note, &deletedAt, &updatedAt); err != nil {
					log.Printf("sync: scan growth_entries family=%s: %v", session.FamilyID, err)
					continue
				}
				if !changedAfter(updatedAt, since) {
					continue
				}
				if deletedAt.Valid && deletedAt.String != "" {
					b, _ := json.Marshal(map[string]any{"id": id, "deletedAt": deletedAt.String})
					resp.Growth = append(resp.Growth, b)
					continue
				}
				b, _ := json.Marshal(map[string]any{
					"id": id, "date": date,
					"weightKg": nullFloatOrNil(weightKg), "heightCm": nullFloatOrNil(heightCm), "headCm": nullFloatOrNil(headCm),
					"note": note.String,
				})
				resp.Growth = append(resp.Growth, b)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func syncLowerBound(since string) string {
	if since == "" {
		return ""
	}
	s, err := time.Parse(time.RFC3339Nano, since)
	if err != nil {
		log.Printf("sync: invalid since %q: %v; falling back to lexical lower bound", since, err)
		return since
	}
	return s.UTC().Format("2006-01-02T15:04:05")
}

func changedAfter(updatedAt, since string) bool {
	if since == "" {
		return true
	}
	u, uErr := time.Parse(time.RFC3339Nano, updatedAt)
	s, sErr := time.Parse(time.RFC3339Nano, since)
	if uErr == nil && sErr == nil {
		return u.After(s)
	}
	if uErr != nil {
		log.Printf("sync: invalid updated_at %q: %v; falling back to lexical comparison", updatedAt, uErr)
	}
	if sErr != nil {
		log.Printf("sync: invalid since %q: %v; falling back to lexical comparison", since, sErr)
	}
	return updatedAt > since
}

func tombstoneOrPayload(payload string, deletedAt sql.NullString, caregiverID string) json.RawMessage {
	if deletedAt.Valid && deletedAt.String != "" {
		var withID struct {
			ID string `json:"id"`
		}
		json.Unmarshal([]byte(payload), &withID)
		b, _ := json.Marshal(map[string]string{"id": withID.ID, "deletedAt": deletedAt.String})
		return b
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(payload), &obj); err != nil {
		return json.RawMessage(payload)
	}
	obj["caregiverId"] = caregiverID
	b, _ := json.Marshal(obj)
	return b
}

func nullFloatOrNil(f sql.NullFloat64) any {
	if !f.Valid {
		return nil
	}
	return f.Float64
}
