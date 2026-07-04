package main

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaFS embed.FS

func openDB(path string) (*sql.DB, error) {
	dsn := path
	// WAL lets readers and a writer proceed concurrently instead of locking
	// the whole file; busy_timeout makes a second writer wait for the lock
	// rather than failing immediately with SQLITE_BUSY. Without these, two
	// handlers writing back-to-back (e.g. family creation immediately
	// followed by a settings PATCH) can hit a bare "database is locked" 500.
	if path != ":memory:" {
		dsn = path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// In-memory SQLite is per-connection in modernc.org/sqlite; without
	// pinning the pool to a single connection, parallel test goroutines
	// each get their own empty database and the shared schema vanishes.
	if path == ":memory:" {
		db.SetMaxOpenConns(1)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	schema, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(string(schema)); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE caregivers ADD COLUMN photo TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE caregivers ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE caregivers ADD COLUMN removed_at TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return nil, err
	}
	if _, err := db.Exec(`UPDATE caregivers SET updated_at = created_at WHERE updated_at = ''`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`ALTER TABLE settings ADD COLUMN playtypes_json TEXT NOT NULL DEFAULT '[]'`); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return nil, err
	}
	return db, nil
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z")
}

// newID returns a random 16-byte hex string, used as the primary key for
// every row this server creates (families, babies, caregivers, entries...).
func newID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
