package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"
)

const inviteTTL = 48 * time.Hour

type createInviteResponse struct {
	Token string `json:"token"`
}

func handleCreateInvite(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		token := newID()
		expiresAt := time.Now().UTC().Add(inviteTTL).Format(time.RFC3339Nano)

		_, err := db.Exec(`INSERT INTO invites (token_hash, family_id, created_by, expires_at) VALUES (?, ?, ?, ?)`,
			hashToken(token), session.FamilyID, session.CaregiverID, expiresAt)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(createInviteResponse{Token: token})
	}
}

type joinInviteRequest struct {
	CaregiverName string `json:"caregiverName"`
}

type joinInviteResponse struct {
	FamilyID    string `json:"familyId"`
	CaregiverID string `json:"caregiverId"`
}

// errInviteInvalid means the token matched a row that can no longer be
// used (expired or already consumed) — distinct from sql.ErrNoRows (the
// token never matched any invite at all), so callers can keep their
// existing 404-vs-410 distinction.
var errInviteInvalid = errors.New("invite expired or already used")

// consumeInvite validates an invite token inside tx and returns the family
// it grants access to. It does NOT mark the invite used — the caller does
// that (with matchedHash, not a fresh hash of token) once it has also
// committed whatever the invite was for, so a crash between validation and
// use can't leave an invite consumed with nothing to show for it.
func consumeInvite(tx *sql.Tx, token string) (familyID, matchedHash string, err error) {
	var expiresAt string
	var usedAt sql.NullString
	matchedHash, err = lookupByToken(tx, `SELECT token_hash, family_id, expires_at, used_at FROM invites WHERE token_hash IN (%s)`,
		token, &familyID, &expiresAt, &usedAt)
	if err != nil {
		return "", "", err
	}
	if usedAt.Valid && usedAt.String != "" {
		return "", "", errInviteInvalid
	}
	expiry, perr := time.Parse(time.RFC3339Nano, expiresAt)
	if perr != nil || time.Now().UTC().After(expiry) {
		return "", "", errInviteInvalid
	}
	return familyID, matchedHash, nil
}

func handleJoinInvite(db *sql.DB, hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.PathValue("token")

		var req joinInviteRequest
		json.NewDecoder(r.Body).Decode(&req) // best-effort; empty name falls back below
		caregiverName := req.CaregiverName
		if caregiverName == "" {
			caregiverName = "Caregiver"
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()

		familyID, matchedHash, err := consumeInvite(tx, token)
		if err == sql.ErrNoRows {
			http.Error(w, "invite not found", http.StatusNotFound)
			return
		}
		if err == errInviteInvalid {
			http.Error(w, "invite expired or already used", http.StatusGone)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		caregiverID := newID()
		now := nowISO()
		rev, err := bumpRev(tx, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if _, err := tx.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, updated_at, created_at, rev) VALUES (?, ?, ?, 'Partner', ?, ?, ?)`,
			caregiverID, familyID, caregiverName, now, now, rev); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		res, err := tx.Exec(`UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`, now, matchedHash)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "invite expired or already used", http.StatusGone)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}

		sessToken, err := createSession(db, caregiverID, familyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, sessToken)
		hub.Broadcast(familyID)
		log.Printf("caregiver joined: name=%q family=%s", caregiverName, familyID)
		logAuthEvent(r, "invite_join", SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(joinInviteResponse{FamilyID: familyID, CaregiverID: caregiverID})
	}
}
