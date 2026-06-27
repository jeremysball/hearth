package main

import (
	"database/sql"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jeremysball/hearth"
)

// logMiddleware logs every request: method, path, status, and elapsed time.
// Static file requests (no /api/ prefix) are logged at a lower signal — only
// non-200 responses — to avoid noise from the shell assets.
func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		isAPI := len(r.URL.Path) > 4 && r.URL.Path[:5] == "/api/"
		if isAPI || rw.status >= 400 {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, rw.status, time.Since(start).Round(time.Millisecond))
		}
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(status int) {
	sw.status = status
	sw.ResponseWriter.WriteHeader(status)
}

func newRouter(db *sql.DB, hub *Hub, staticDir string, cfg Config) http.Handler {
	var staticFS fs.FS = hearth.StaticFS
	if staticDir != "" {
		staticFS = os.DirFS(staticDir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/launch-tokens", requireAuth(db, handleCreateLaunchToken(db)))
	mux.HandleFunc("GET /api/launch/{token}", handleRedeemLaunchToken(db))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("GET /join/{token}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, staticFS, "index.html")
	})
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.HandleFunc("GET /api/caregivers", requireAuth(db, handleListCaregivers(db)))
	mux.HandleFunc("GET /api/auth/{provider}", handleAuthBegin(cfg))
	mux.HandleFunc("GET /api/auth/{provider}/callback", handleAuthCallback(db, cfg))
	mux.Handle("/", http.FileServerFS(staticFS))
	return logMiddleware(mux)
}
