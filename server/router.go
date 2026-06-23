package main

import (
	"database/sql"
	"net/http"
	"os"
)

func newRouter(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "."
	}
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	return mux
}
