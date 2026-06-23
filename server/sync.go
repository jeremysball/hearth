package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type syncResponse struct {
	ServerTime string            `json:"serverTime"`
	Baby       json.RawMessage   `json:"baby,omitempty"`
	Settings   json.RawMessage   `json:"settings,omitempty"`
	Entries    []json.RawMessage `json:"entries"`
	Growth     []json.RawMessage `json:"growth"`
}

func handleSync(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		since := r.URL.Query().Get("since")

		resp := syncResponse{ServerTime: nowISO(), Entries: []json.RawMessage{}, Growth: []json.RawMessage{}}

		var name, birthdate, theme string
		var photo sql.NullString
		var babyUpdatedAt string
		err := db.QueryRow(`SELECT name, birthdate, theme, photo, updated_at FROM babies WHERE family_id = ?`, session.FamilyID).
			Scan(&name, &birthdate, &theme, &photo, &babyUpdatedAt)
		if err == nil && babyUpdatedAt > since {
			b, _ := json.Marshal(map[string]any{"name": name, "birthdate": birthdate, "theme": theme, "photo": photo.String})
			resp.Baby = b
		}

		var bottleIntervalH float64
		var medsJSON, unitsJSON, remindersJSON, cardsJSON, settingsUpdatedAt string
		err = db.QueryRow(`SELECT bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at FROM settings WHERE family_id = ?`, session.FamilyID).
			Scan(&bottleIntervalH, &medsJSON, &unitsJSON, &remindersJSON, &cardsJSON, &settingsUpdatedAt)
		if err == nil && settingsUpdatedAt > since {
			s, _ := json.Marshal(map[string]any{
				"bottleIntervalH": bottleIntervalH,
				"meds":            json.RawMessage(medsJSON),
				"units":           json.RawMessage(unitsJSON),
				"reminders":       json.RawMessage(remindersJSON),
				"cards":           json.RawMessage(cardsJSON),
			})
			resp.Settings = s
		}

		rows, err := db.Query(`SELECT payload_json, deleted_at FROM log_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, since)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var payload string
				var deletedAt sql.NullString
				if err := rows.Scan(&payload, &deletedAt); err != nil {
					continue
				}
				resp.Entries = append(resp.Entries, tombstoneOrPayload(payload, deletedAt))
			}
		}

		grows, err := db.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, deleted_at FROM growth_entries WHERE family_id = ? AND updated_at > ?`, session.FamilyID, since)
		if err == nil {
			defer grows.Close()
			for grows.Next() {
				var id, date string
				var weightKg, heightCm, headCm sql.NullFloat64
				var note, deletedAt sql.NullString
				if err := grows.Scan(&id, &date, &weightKg, &heightCm, &headCm, &note, &deletedAt); err != nil {
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

func tombstoneOrPayload(payload string, deletedAt sql.NullString) json.RawMessage {
	if deletedAt.Valid && deletedAt.String != "" {
		var withID struct {
			ID string `json:"id"`
		}
		json.Unmarshal([]byte(payload), &withID)
		b, _ := json.Marshal(map[string]string{"id": withID.ID, "deletedAt": deletedAt.String})
		return b
	}
	return json.RawMessage(payload)
}

func nullFloatOrNil(f sql.NullFloat64) any {
	if !f.Valid {
		return nil
	}
	return f.Float64
}
