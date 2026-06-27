package main

import (
	"net/http"
	"time"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/apple"
	"github.com/markbates/goth/providers/google"
)

const oauthStateCookie = "hearth_oauth"

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
		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookie,
			Value:    name + "|" + sess.Marshal(),
			Path:     "/",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(10 * time.Minute / time.Second),
		})
		http.Redirect(w, r, url, http.StatusFound)
	}
}
