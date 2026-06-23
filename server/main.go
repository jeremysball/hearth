package main

import (
	"log"
	"net/http"
)

func main() {
	cfg := loadConfig()
	mux := newRouter(nil)
	addr := cfg.Host + ":" + cfg.Port

	log.Printf("Hearth server listening on %s (static: %s)", addr, cfg.StaticDir)
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
