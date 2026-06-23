package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()
	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("opening database %s: %v", cfg.DBPath, err)
	}
	defer db.Close()

	hub := newHub()
	mux := newRouter(db, hub)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (db: %s, static: %s)", addr, cfg.DBPath, cfg.StaticDir)
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
