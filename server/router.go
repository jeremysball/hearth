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
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
