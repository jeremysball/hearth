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
	for _, stmt := range []string{
		`ALTER TABLE families ADD COLUMN rev_counter INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE babies ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE caregivers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE log_entries ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE growth_entries ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := db.Exec(stmt); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
			return nil, err
		}
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_caregivers_family_rev ON caregivers(family_id, rev)`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_log_entries_family_rev ON log_entries(family_id, rev)`); err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_growth_entries_family_rev ON growth_entries(family_id, rev)`); err != nil {
		return nil, err
	}
	return db, nil
}

// bumpRev atomically advances a family's revision counter within tx and
// returns the new value. Every write that touches a sync-visible row must
// call this and stamp the row's own `rev` column with the result, in the
// same transaction as the row write, so a concurrent reader's snapshot never
// sees the counter advance without also seeing the row it covers (or vice
// versa) — see docs/superpowers/specs/2026-07-04-sync-cursor-revision-counter.md.
func bumpRev(tx *sql.Tx, familyID string) (int64, error) {
	var rev int64
	err := tx.QueryRow(`UPDATE families SET rev_counter = rev_counter + 1 WHERE id = ? RETURNING rev_counter`, familyID).Scan(&rev)
	return rev, err
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
