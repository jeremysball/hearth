package main

import (
	"database/sql"
	"net/http"
)

func newRouter(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/family", handleCreateFamily(db))
	mux.Handle("/", http.FileServer(http.Dir(".")))
	return mux
}
