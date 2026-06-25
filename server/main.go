package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()

	log.Printf("Hearth starting up")
	log.Printf("  db:     %s", cfg.DBPath)
	staticLabel := cfg.StaticDir
	if staticLabel == "" {
		staticLabel = "embedded"
	}
	log.Printf("  static: %s", staticLabel)

	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("opening database %s: %v", cfg.DBPath, err)
	}
	defer db.Close()
	log.Printf("  db open OK")

	hub := newHub()
	mux := newRouter(db, hub, cfg.StaticDir)
	addr := cfg.Host + ":" + cfg.Port

	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Printf("listening on https://%s (TLS)", addr)
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Printf("listening on http://%s", addr)
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
