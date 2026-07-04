package server

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Run starts the Hearth server and blocks until it shuts down. The cmd/hearth
// binary is a thin wrapper around this so the actual server logic stays a
// regular importable package (testable, and usable by other entrypoints)
// instead of living in package main.
func Run() {
	cfg := loadConfig()
	if err := validateVAPIDEnv(); err != nil {
		log.Fatal(err)
	}
	initProviders(cfg)
	peppers = loadPeppers() // fail-fast at startup, same spot as setupGeoIP/initProviders

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
	// Closing the last connection to a WAL-mode database triggers SQLite's
	// automatic checkpoint, folding the -wal file back into the main db file.
	// Without a graceful shutdown path, SIGTERM (docker stop, or Watchtower's
	// auto-update restarts) kills the process before this deferred Close ever
	// runs, leaving recent writes parked in the -wal file instead of the
	// single-file snapshot a backup would expect.
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
	srv := &http.Server{Addr: addr, Handler: mux}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sig
		log.Printf("shutting down")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()

	var serveErr error
	if cfg.CertFile != "" && cfg.KeyFile != "" {
		log.Printf("listening on https://%s (TLS)", addr)
		serveErr = srv.ListenAndServeTLS(cfg.CertFile, cfg.KeyFile)
	} else {
		log.Printf("listening on http://%s", addr)
		serveErr = srv.ListenAndServe()
	}
	if serveErr != nil && serveErr != http.ErrServerClosed {
		log.Fatal(serveErr)
	}
}
