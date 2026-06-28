package main

import "database/sql"

type ReconcileResult struct {
	Kind             string
	CaregiverID      string
	FamilyID         string
	TargetFamily     string
	CurrentFamily    string
	CurrentCaregiver string
}

func familyHasData(db *sql.DB, familyID string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM log_entries WHERE family_id = ? AND deleted_at IS NULL`, familyID).Scan(&n)
	return n > 0, err
}

func reconcile(db *sql.DB, provider, providerUserID, email string, cur *SessionInfo) (ReconcileResult, error) {
	var caregiverID, familyID string
	err := db.QueryRow(`
		SELECT i.caregiver_id, c.family_id
		FROM identities i JOIN caregivers c ON c.id = i.caregiver_id
		WHERE i.provider = ? AND i.provider_user_id = ?`, provider, providerUserID).
		Scan(&caregiverID, &familyID)

	if err == sql.ErrNoRows {
		// No identity yet.
		if cur != nil {
			// Link to the existing anonymous caregiver.
			if _, e := db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
				provider, providerUserID, cur.CaregiverID, email, nowISO()); e != nil {
				return ReconcileResult{}, e
			}
			return ReconcileResult{Kind: "linked", CaregiverID: cur.CaregiverID, FamilyID: cur.FamilyID}, nil
		}
		// Sign up: fresh family + caregiver + default settings, then identity.
		newFamily, newBaby, newCare := newID(), newID(), newID()
		now := nowISO()
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		if _, e = tx.Exec(`INSERT INTO families (id, created_at) VALUES (?, ?)`, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES (?, ?, '', '', 'girl', ?)`, newBaby, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES (?, ?, 'Parent', 'Parent', ?)`, newCare, newFamily, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO settings (family_id, units_json, reminders_json, cards_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
			newFamily, defaultUnitsJSON, defaultRemindersJSON, defaultCardsJSON, now); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
			provider, providerUserID, newCare, email, now); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		return ReconcileResult{Kind: "signedup", CaregiverID: newCare, FamilyID: newFamily}, nil
	}
	if err != nil {
		return ReconcileResult{}, err
	}

	// Identity exists → family B (familyID).
	if cur == nil || cur.FamilyID == familyID {
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
	// Different families. Conflict only if the device's family A actually holds data.
	hasData, e := familyHasData(db, cur.FamilyID)
	if e != nil {
		return ReconcileResult{}, e
	}
	if !hasData {
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
	return ReconcileResult{
		Kind:             "conflict",
		TargetFamily:     familyID,
		CurrentFamily:    cur.FamilyID,
		CurrentCaregiver: cur.CaregiverID,
	}, nil
}
