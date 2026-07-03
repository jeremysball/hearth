package main

import (
	"log"
	"net/http"
	"time"
)

func main() {
	cfg := loadConfig()
	if err := validateVAPIDEnv(); err != nil {
		log.Fatal(err)
	}
	initProviders(cfg)

	log.Printf("Hearth starting up")
	log.Printf("  db:     %s", cfg.DBPath)
	staticLabel := cfg.StaticDir
	if staticLabel == "" {
		staticLabel = "embedded"
	}
	log.Printf("  static: %s", staticLabel)
	geo, err := setupGeoIP(cfg)
	if err != nil {
		log.Fatalf("geoip setup: %v", err)
	}
	requestGeoIP = geo
	if geo != nil {
		defer geo.Close()
		log.Printf("  geoip:  %s", cfg.GeoIPDBPath)
	}

	db, err := openDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("opening database %s: %v", cfg.DBPath, err)
	}
	defer db.Close()
	log.Printf("  db open OK")

	pushes := newPushScheduler(db)
	pushes.ScheduleAll()
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			pushes.ScheduleAll()
		}
	}()
	log.Printf("  push scheduler armed")

	hub := newHub()
	mux := newRouter(db, hub, cfg.StaticDir, cfg, pushes)
	addr := cfg.Host + ":" + cfg.Port

	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Printf("listening on https://%s (TLS)", addr)
		log.Fatal(http.ListenAndServeTLS(addr, cfg.CertFile, cfg.KeyFile, mux))
	} else {
		log.Printf("listening on http://%s", addr)
		log.Fatal(http.ListenAndServe(addr, mux))
	}
}
