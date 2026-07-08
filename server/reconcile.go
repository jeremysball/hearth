package server

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

func caregiverRemoved(db *sql.DB, caregiverID string) (bool, error) {
	var removedAt string
	if err := db.QueryRow(`SELECT removed_at FROM caregivers WHERE id = ?`, caregiverID).Scan(&removedAt); err != nil {
		return false, err
	}
	return removedAt != "", nil
}

// anyFamilyExists reports whether this instance has ever been provisioned.
// handleCreateFamily (server/family.go) already refuses to create a second
// family once one exists; the OAuth signedup path below must refuse the
// same way, or a stranger clicking "Continue with Google" on an
// already-provisioned instance silently gets their own private family in
// the same database.
func anyFamilyExists(db *sql.DB) (bool, error) {
	var exists bool
	err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM families)`).Scan(&exists)
	return exists, err
}

// reconcile decides what an OAuth sign-in means for this device.
//
// cur is the device's live session, if any. deviceFamily is the family id the
// client last synced with (sent as a hint through the OAuth flow); it lets a
// device whose session rows were lost prove which family its local data
// belongs to, so a sign-in cannot silently restore into a different family.
// inviteToken, when set, lets a fresh identity (or a removed one) join the
// one existing family on a provisioned instance; without it, reconcile
// returns Kind="denied" so a stranger on an already-provisioned instance
// can't spin up a second private family.
func reconcile(db *sql.DB, hub *Hub, provider, providerUserID, email string, cur *SessionInfo, deviceFamily, inviteToken string) (ReconcileResult, error) {
	// A stale session cookie for a caregiver an admin has since removed must
	// not be treated as a live device to link or restore onto — that would
	// hand the signed-in-again OAuth account a session that 401s on the very
	// next request. Surface the removal explicitly instead.
	if cur != nil {
		removed, e := caregiverRemoved(db, cur.CaregiverID)
		if e != nil {
			return ReconcileResult{}, e
		}
		if removed {
			return ReconcileResult{Kind: "removed"}, nil
		}
	}

	var caregiverID, familyID, removedAt string
	err := db.QueryRow(`
		SELECT i.caregiver_id, c.family_id, c.removed_at
		FROM identities i JOIN caregivers c ON c.id = i.caregiver_id
		WHERE i.provider = ? AND i.provider_user_id = ?`, provider, providerUserID).
		Scan(&caregiverID, &familyID, &removedAt)

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
		exists, e := anyFamilyExists(db)
		if e != nil {
			return ReconcileResult{}, e
		}
		if !exists {
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
			if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at) VALUES (?, ?, 'Parent', 'Parent', ?, ?)`, newCare, newFamily, now, now); e != nil {
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

		// The instance already has its one family. A stranger without a
		// valid invite must not be handed a caregiver seat in it.
		if inviteToken == "" {
			return ReconcileResult{Kind: "denied"}, nil
		}
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		inviteFamily, matchedHash, e := consumeInvite(tx, inviteToken)
		if e == sql.ErrNoRows || e == errInviteInvalid {
			return ReconcileResult{Kind: "denied"}, nil
		}
		if e != nil {
			return ReconcileResult{}, e
		}
		newCare := newID()
		now := nowISO()
		rev, e := bumpRev(tx, inviteFamily)
		if e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, rev) VALUES (?, ?, 'Caregiver', 'Partner', ?, ?, ?)`,
			newCare, inviteFamily, now, now, rev); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now, matchedHash); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES (?, ?, ?, ?, ?)`,
			provider, providerUserID, newCare, email, now); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		hub.Broadcast(inviteFamily)
		return ReconcileResult{Kind: "linked", CaregiverID: newCare, FamilyID: inviteFamily}, nil
	}
	if err != nil {
		return ReconcileResult{}, err
	}
	if removedAt != "" {
		// This provider account was linked to a caregiver who has since been
		// removed. If the device holds a live session (cur passed the removed
		// check above), the person behind this verified provider account is a
		// live member again — e.g. removed and then re-invited. Relink the
		// identity to the live caregiver so Google sign-in works for the
		// membership she actually has; no entries move. Without a live
		// session, signing in must not resurrect the removed caregiver, nor
		// silently spin up a fresh family as if this were a brand-new user —
		// unless the sign-in comes with a valid invite that names the same
		// family, in which case we reactivate the same caregiver row in place.
		if cur != nil {
			if _, e := db.Exec(`UPDATE identities SET caregiver_id = ? WHERE provider = ? AND provider_user_id = ?`,
				cur.CaregiverID, provider, providerUserID); e != nil {
				return ReconcileResult{}, e
			}
			return ReconcileResult{Kind: "linked", CaregiverID: cur.CaregiverID, FamilyID: cur.FamilyID}, nil
		}
		if inviteToken == "" {
			return ReconcileResult{Kind: "removed"}, nil
		}
		tx, e := db.Begin()
		if e != nil {
			return ReconcileResult{}, e
		}
		defer tx.Rollback()
		inviteFamily, matchedHash, e := consumeInvite(tx, inviteToken)
		if e == sql.ErrNoRows || e == errInviteInvalid {
			return ReconcileResult{Kind: "removed"}, nil
		}
		if e != nil {
			return ReconcileResult{}, e
		}
		if inviteFamily != familyID {
			return ReconcileResult{Kind: "removed"}, nil
		}
		now := nowISO()
		rev, e := bumpRev(tx, familyID)
		if e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE caregivers SET removed_at = '', updated_at = ?, rev = ? WHERE id = ? AND family_id = ?`,
			now, rev, caregiverID, familyID); e != nil {
			return ReconcileResult{}, e
		}
		if _, e = tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now, matchedHash); e != nil {
			return ReconcileResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return ReconcileResult{}, e
		}
		hub.Broadcast(familyID)
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}

	// Identity exists → family B (familyID).
	if cur == nil {
		// No live session. If the device says its local data belongs to a
		// different family that actually holds data, restoring into the
		// identity's family would silently split the two: every write from
		// this device would land in family B while the rest of the device's
		// family keeps writing to family A, with zero errors on either side.
		// Refuse to pick a family; surface the mismatch instead. deviceFamily
		// is a client-supplied hint, so it never grants access — "mismatch"
		// creates no session and moves no data.
		if deviceFamily != "" && deviceFamily != familyID {
			hasData, e := familyHasData(db, deviceFamily)
			if e != nil {
				return ReconcileResult{}, e
			}
			if hasData {
				return ReconcileResult{Kind: "mismatch", TargetFamily: familyID, CurrentFamily: deviceFamily}, nil
			}
		}
		return ReconcileResult{Kind: "restored", CaregiverID: caregiverID, FamilyID: familyID}, nil
	}
	if cur.FamilyID == familyID {
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
