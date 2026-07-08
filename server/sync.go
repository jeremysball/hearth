package server

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

type syncResponse struct {
	ServerRev          int64             `json:"serverRev"`
	FamilyID           string            `json:"familyId"`
	Baby               json.RawMessage   `json:"baby,omitempty"`
	Settings           json.RawMessage   `json:"settings,omitempty"`
	Entries            []json.RawMessage `json:"entries"`
	Growth             []json.RawMessage `json:"growth"`
	Caregivers         []json.RawMessage `json:"caregivers"`
	CurrentCaregiverID string            `json:"currentCaregiverId"`
}

// sinceRev parses the client's cursor as an integer revision. A missing or
// non-numeric value (empty string, or a pre-upgrade client still sending an
// RFC3339 timestamp) is treated as -1, which is always below every row's
// `rev` (rows default to 0), forcing one full resync. mergeById on the
// client is idempotent and keyed by id, so a forced full resync just costs
// one oversized poll, not a correctness problem.
func sinceRev(raw string) int64 {
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return -1
	}
	return v
}

func handleSync(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		since := sinceRev(r.URL.Query().Get("since"))

		resp := syncResponse{Entries: []json.RawMessage{}, Growth: []json.RawMessage{}, Caregivers: []json.RawMessage{}, CurrentCaregiverID: session.CaregiverID, FamilyID: session.FamilyID}

		tx, err := db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		if err := tx.QueryRow(`SELECT rev_counter FROM families WHERE id = ?`, session.FamilyID).Scan(&resp.ServerRev); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		var name, birthdate, theme string
		var photo sql.NullString
		var babyRev int64
		err = tx.QueryRow(`SELECT name, birthdate, theme, photo, rev FROM babies WHERE family_id = ?`, session.FamilyID).
			Scan(&name, &birthdate, &theme, &photo, &babyRev)
		if err == nil && babyRev > since {
			b, _ := json.Marshal(map[string]any{"name": name, "birthdate": birthdate, "theme": theme, "photo": photo.String})
			resp.Baby = b
		}

		var bottleIntervalH float64
		var bottleAmountDefault float64
		var medsJSON, hygieneJSON, unitsJSON, remindersJSON, cardsJSON, playTypesJSON string
		var settingsRev int64
		err = tx.QueryRow(`SELECT bottle_interval_h, bottle_amount_default, meds_json, hygiene_json, units_json, reminders_json, cards_json, playtypes_json, rev FROM settings WHERE family_id = ?`, session.FamilyID).
			Scan(&bottleIntervalH, &bottleAmountDefault, &medsJSON, &hygieneJSON, &unitsJSON, &remindersJSON, &cardsJSON, &playTypesJSON, &settingsRev)
		if err == nil && settingsRev > since {
			s, _ := json.Marshal(map[string]any{
				"bottleIntervalH":     bottleIntervalH,
				"bottleAmountDefault": bottleAmountDefault,
				"meds":                json.RawMessage(medsJSON),
				"hygiene":             json.RawMessage(hygieneJSON),
				"units":               json.RawMessage(unitsJSON),
				"reminders":           json.RawMessage(remindersJSON),
				"cards":               json.RawMessage(cardsJSON),
				"playTypes":           json.RawMessage(playTypesJSON),
			})
			resp.Settings = s
		}

		adminID := ""
		tx.QueryRow(`SELECT id FROM caregivers WHERE family_id = ? AND removed_at = '' ORDER BY created_at LIMIT 1`, session.FamilyID).Scan(&adminID)
		caregiverRows, err := tx.Query(`SELECT id, display_name, role, photo, removed_at FROM caregivers WHERE family_id = ? AND rev > ? ORDER BY created_at`, session.FamilyID, since)
		if err == nil {
			defer caregiverRows.Close()
			for caregiverRows.Next() {
				var id, displayName, role, photo, removedAt string
				if err := caregiverRows.Scan(&id, &displayName, &role, &photo, &removedAt); err != nil {
					log.Printf("sync: scan caregivers family=%s: %v", session.FamilyID, err)
					continue
				}
				b, _ := json.Marshal(caregiverInfo{ID: id, DisplayName: displayName, Role: role, Photo: photo, RemovedAt: removedAt, IsAdmin: removedAt == "" && id == adminID})
				resp.Caregivers = append(resp.Caregivers, b)
			}
		}

		rows, err := tx.Query(`SELECT payload_json, created_by, deleted_at FROM log_entries WHERE family_id = ? AND rev > ?`, session.FamilyID, since)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var payload, createdBy string
				var deletedAt sql.NullString
				if err := rows.Scan(&payload, &createdBy, &deletedAt); err != nil {
					log.Printf("sync: scan log_entries family=%s: %v", session.FamilyID, err)
					continue
				}
				resp.Entries = append(resp.Entries, tombstoneOrPayload(payload, deletedAt, createdBy))
			}
		}

		grows, err := tx.Query(`SELECT id, date, weight_kg, height_cm, head_cm, note, deleted_at FROM growth_entries WHERE family_id = ? AND rev > ?`, session.FamilyID, since)
		if err == nil {
			defer grows.Close()
			for grows.Next() {
				var id, date string
				var weightKg, heightCm, headCm sql.NullFloat64
				var note, deletedAt sql.NullString
				if err := grows.Scan(&id, &date, &weightKg, &heightCm, &headCm, &note, &deletedAt); err != nil {
					log.Printf("sync: scan growth_entries family=%s: %v", session.FamilyID, err)
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
