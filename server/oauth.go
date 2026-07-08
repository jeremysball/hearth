package server

import (
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/apple"
	"github.com/markbates/goth/providers/google"
)

const oauthStateCookie = "hearth_oauth"

// oauthDeviceFamilyCookie carries the client's "my local data belongs to this
// family" hint across the provider redirect, so the callback can detect a
// sign-in that would land the device in a different family than its data.
const oauthDeviceFamilyCookie = "hearth_oauth_device_family"

// validDeviceFamily accepts only newID-shaped values (hex, bounded length) so
// an arbitrary client string never lands in a cookie or a log line.
func validDeviceFamily(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// initProviders registers goth providers for whichever ones are configured.
// Unconfigured providers are skipped so the app runs anonymously without creds.
func initProviders(cfg Config) {
	var ps []goth.Provider
	if cfg.OAuthConfigured("google") {
		ps = append(ps, google.New(cfg.GoogleClientID, cfg.GoogleClientSecret,
			cfg.PublicBaseURL+"/api/auth/google/callback", "email", "profile"))
	}
	if cfg.OAuthConfigured("apple") {
		ps = append(ps, apple.New(cfg.AppleClientID, cfg.AppleClientSecret,
			cfg.PublicBaseURL+"/api/auth/apple/callback", nil, apple.ScopeName, apple.ScopeEmail))
	}
	if len(ps) > 0 {
		goth.UseProviders(ps...)
	}
}

func handleAuthBegin(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		if !cfg.OAuthConfigured(name) {
			http.Error(w, "provider not configured", http.StatusNotFound)
			return
		}
		provider, err := goth.GetProvider(name)
		if err != nil {
			http.Error(w, "unknown provider", http.StatusNotFound)
			return
		}
		state := newID()
		sess, err := provider.BeginAuth(state)
		if err != nil {
			http.Error(w, "auth begin failed", http.StatusInternalServerError)
			return
		}
		url, err := sess.GetAuthURL()
		if err != nil {
			http.Error(w, "auth url failed", http.StatusInternalServerError)
			return
		}
		encoded := base64.StdEncoding.EncodeToString([]byte(name + "|" + sess.Marshal()))
		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookie,
			Value:    encoded,
			Path:     "/",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(10 * time.Minute / time.Second),
		})
		if df := r.URL.Query().Get("device_family"); validDeviceFamily(df) {
			http.SetCookie(w, &http.Cookie{
				Name:     oauthDeviceFamilyCookie,
				Value:    df,
				Path:     "/",
				HttpOnly: true,
				Secure:   true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   int(10 * time.Minute / time.Second),
			})
		}
		http.Redirect(w, r, url, http.StatusFound)
	}
}

// lookupExistingSession resolves the caregiver/family for a raw session
// token, or nil if it doesn't match any session. Split out from
// handleAuthCallback so the OAuth "does the browser already have a session"
// branch is testable without mocking the goth provider flow.
func lookupExistingSession(db *sql.DB, token string) *SessionInfo {
	var familyID, caregiverID string
	_, err := lookupByToken(db, `SELECT token_hash, family_id, caregiver_id FROM sessions WHERE token_hash IN (%s)`,
		token, &familyID, &caregiverID)
	if err != nil {
		return nil
	}
	return &SessionInfo{FamilyID: familyID, CaregiverID: caregiverID}
}

func handleAuthCallback(db *sql.DB, hub *Hub, cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("provider")
		if !cfg.OAuthConfigured(name) {
			http.Error(w, "provider not configured", http.StatusNotFound)
			return
		}
		provider, err := goth.GetProvider(name)
		if err != nil {
			http.Error(w, "unknown provider", http.StatusNotFound)
			return
		}
		cookie, err := r.Cookie(oauthStateCookie)
		if err != nil {
			log.Printf("oauth: %s callback: missing state cookie (likely served over non-HTTPS, so the Secure cookie was dropped): %v", name, err)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		// cookie value is base64(name|marshaledSession)
		decoded, decErr := base64.StdEncoding.DecodeString(cookie.Value)
		if decErr != nil {
			log.Printf("oauth: %s callback: state cookie not valid base64: %v", name, decErr)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		marshaled := string(decoded)
		if _, after, ok := strings.Cut(marshaled, "|"); ok {
			marshaled = after
		}
		sess, err := provider.UnmarshalSession(marshaled)
		if err != nil {
			log.Printf("oauth: %s callback: failed to unmarshal provider session: %v", name, err)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		if _, err = sess.Authorize(provider, r.URL.Query()); err != nil {
			log.Printf("oauth: %s callback: provider authorize failed (check PUBLIC_BASE_URL matches the redirect URI registered with the provider): %v", name, err)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		gu, err := provider.FetchUser(sess)
		if err != nil {
			log.Printf("oauth: %s callback: fetch user info failed: %v", name, err)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		// clear the state cookie
		http.SetCookie(w, &http.Cookie{Name: oauthStateCookie, Path: "/", MaxAge: -1})

		var cur *SessionInfo
		if sc, err := r.Cookie(sessionCookieName); err == nil {
			cur = lookupExistingSession(db, sc.Value)
		}

		deviceFamily := ""
		if dc, err := r.Cookie(oauthDeviceFamilyCookie); err == nil && validDeviceFamily(dc.Value) {
			deviceFamily = dc.Value
		}
		http.SetCookie(w, &http.Cookie{Name: oauthDeviceFamilyCookie, Path: "/", MaxAge: -1})

		res, err := reconcile(db, hub, name, gu.UserID, gu.Email, cur, deviceFamily, "")
		if err != nil {
			log.Printf("oauth: %s callback: reconcile failed for email=%q: %v", name, gu.Email, err)
			http.Redirect(w, r, "/?auth=error", http.StatusFound)
			return
		}
		switch res.Kind {
		case "linked", "restored", "signedup":
			token, e := createSession(db, res.CaregiverID, res.FamilyID)
			if e != nil {
				log.Printf("oauth: %s callback: create session failed for caregiver=%s family=%s: %v", name, res.CaregiverID, res.FamilyID, e)
				http.Redirect(w, r, "/?auth=error", http.StatusFound)
				return
			}
			setSessionCookie(w, token)
			logAuthEvent(r, "oauth_"+res.Kind, SessionInfo{CaregiverID: res.CaregiverID, FamilyID: res.FamilyID})
			http.Redirect(w, r, "/?auth=ok", http.StatusFound)
		case "removed":
			logAuthEvent(r, "oauth_removed", SessionInfo{})
			http.Redirect(w, r, "/?auth=removed", http.StatusFound)
		case "conflict":
			pending := newID()
			if _, e := db.Exec(`INSERT INTO pending_auth (token_hash, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
				hashToken(pending), name, gu.UserID, gu.Email, res.TargetFamily, res.CurrentFamily, res.CurrentCaregiver, nowISO()); e != nil {
				log.Printf("oauth: %s callback: pending_auth insert failed: %v", name, e)
				http.Redirect(w, r, "/?auth=error", http.StatusFound)
				return
			}
			http.Redirect(w, r, "/?auth=conflict&pending="+pending, http.StatusFound)
		}
	}
}
