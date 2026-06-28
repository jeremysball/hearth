package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"net/http"
)

type ctxKey string

const ctxSessionKey ctxKey = "session"
const sessionCookieName = "hearth_session"
const sessionCookieMaxAge = 10 * 365 * 24 * 60 * 60 // ~10 years; revocation is by deleting the row, not by expiry

type SessionInfo struct {
	CaregiverID string
	FamilyID    string
}

func newSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type execer interface {
	Exec(string, ...any) (sql.Result, error)
}

func createSession(ex execer, caregiverID, familyID string) (string, error) {
	token, err := newSessionToken()
	if err != nil {
		return "", err
	}
	now := nowISO()
	_, err = ex.Exec(`INSERT INTO sessions (token, caregiver_id, family_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`,
		token, caregiverID, familyID, now, now)
	if err != nil {
		return "", err
	}
	return token, nil
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionCookieMaxAge,
	})
}

// requireAuth wraps a handler so it only runs for requests carrying a valid
// session cookie, and attaches the resolved SessionInfo to the request context.
func requireAuth(db *sql.DB, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var familyID, caregiverID string
		err = db.QueryRow(`SELECT family_id, caregiver_id FROM sessions WHERE token = ?`, cookie.Value).
			Scan(&familyID, &caregiverID)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		db.Exec(`UPDATE sessions SET last_seen_at = ? WHERE token = ?`, nowISO(), cookie.Value)
		ctx := context.WithValue(r.Context(), ctxSessionKey, SessionInfo{CaregiverID: caregiverID, FamilyID: familyID})
		next(w, r.WithContext(ctx))
	}
}

func sessionFrom(r *http.Request) SessionInfo {
	v, _ := r.Context().Value(ctxSessionKey).(SessionInfo)
	return v
}
