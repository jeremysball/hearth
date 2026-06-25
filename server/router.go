package main

import (
	"database/sql"
	"io/fs"
	"net/http"
	"os"

	"github.com/jeremysball/hearth"
)

func newRouter(db *sql.DB, hub *Hub, staticDir string) http.Handler {
	var staticFS fs.FS = hearth.StaticFS
	if staticDir != "" {
		staticFS = os.DirFS(staticDir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("GET /api/sync", requireAuth(db, handleSync(db)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
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
	mux.Handle("/", http.FileServerFS(staticFS))
	return mux
}
