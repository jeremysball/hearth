package server

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"fmt"
	"log"
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
	for _, table := range []string{"sessions", "invites", "launch_tokens", "pending_auth"} {
		if err := migrateTokenHash(db, table); err != nil {
			return nil, err
		}
	}
	log.Printf("migration: token-hash rewrite complete")
	return db, nil
}

// migrateTokenHash renames table's legacy `token` column to `token_hash`
// (tolerating both a fresh install, where the column never existed, and an
// already-migrated database, where the rename already ran), adds the
// token_hashed sentinel column, then rewrites any un-hashed rows in place.
// The token_hashed = 0 guard on the UPDATE makes this safe to re-run: only
// rows a previous, possibly crashed, run left un-rewritten get touched.
func migrateTokenHash(db *sql.DB, table string) error {
	if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s RENAME COLUMN token TO token_hash`, table)); err != nil &&
		!strings.Contains(err.Error(), "no such column") && !strings.Contains(err.Error(), "duplicate column name") {
		return err
	}
	if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN token_hashed INTEGER NOT NULL DEFAULT 0`, table)); err != nil &&
		!strings.Contains(err.Error(), "duplicate column name") {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query(fmt.Sprintf(`SELECT token_hash FROM %s WHERE token_hashed = 0`, table))
	if err != nil {
		return err
	}
	var raws []string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		raws = append(raws, raw)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	n := 0
	for _, raw := range raws {
		res, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET token_hash = ?, token_hashed = 1 WHERE token_hash = ? AND token_hashed = 0`, table),
			hashToken(raw), raw)
		if err != nil {
			return err
		}
		if affected, _ := res.RowsAffected(); affected > 0 {
			n++
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Printf("migration: token-hash rewrite %s n=%d", table, n)
	return nil
}

// bumpRev advances a family's revision counter within tx and returns the new
// value. Every write that touches a sync-visible row must call this and stamp
// the row's own `rev` column with the result, in the same transaction as the
// row write, so a concurrent reader's snapshot never sees the counter advance
// without the row it covers, or the reverse. See docs/adr/0003-sync-cursor-revision-counter.md.
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
