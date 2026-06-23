package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB, hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.HandleFunc("/api/events", requireAuth(db, handleEvents(hub)))
	mux.HandleFunc("POST /api/invites", requireAuth(db, handleCreateInvite(db)))
	mux.HandleFunc("POST /api/join/{token}", handleJoinInvite(db))
	mux.HandleFunc("PUT /api/entries/{id}", requireAuth(db, handleUpsertEntry(db, hub)))
	mux.HandleFunc("DELETE /api/entries/{id}", requireAuth(db, handleDeleteEntry(db, hub)))
	mux.HandleFunc("PUT /api/growth/{id}", requireAuth(db, handleUpsertGrowth(db, hub)))
	mux.HandleFunc("DELETE /api/growth/{id}", requireAuth(db, handleDeleteGrowth(db, hub)))
	mux.HandleFunc("PATCH /api/baby", requireAuth(db, handlePatchBaby(db, hub)))
	mux.HandleFunc("PATCH /api/settings", requireAuth(db, handlePatchSettings(db, hub)))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
