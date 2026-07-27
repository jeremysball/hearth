package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	_ "modernc.org/sqlite"
)

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
	// Pin the pool to a single connection. Two reasons:
	//
	//  1. Data integrity under concurrent writers. SQLite allows only one
	//     writer, and busy_timeout does NOT wait out a write-lock *upgrade*
	//     conflict on a deferred transaction — so when both caregivers log at
	//     the same moment, a second pooled connection's bumpRev UPDATE fails
	//     immediately with SQLITE_BUSY (5), the write returns 500, and the
	//     entry never lands. Serializing every statement through one
	//     connection removes the contention entirely (SQLite's own write
	//     throughput is far above this app's load). Verified: a two-writer
	//     concurrency test drops from ~1 lost write per 300 to zero.
	//
	//  2. In-memory SQLite is per-connection in modernc.org/sqlite; without
	//     one shared connection, parallel test goroutines each get their own
	//     empty database and the shared schema vanishes.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	// Migrations live in server/migrations/*.sql, applied in order. The
	// schema_migrations table records which versions have run; the
	// schema.sql hash stamp on PRAGMA user_version is the "this binary
	// already opened this DB" sentinel — see migrate.go.
	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := verifySchemaHash(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
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

// handleSoftDelete builds a delete handler for a sync-visible table (one of
// log_entries, growth_entries): bump the family rev, stamp deleted_at, commit,
// and broadcast. table is always a package-internal constant, never request
// input, so building the UPDATE with Sprintf carries no injection risk.
func handleSoftDelete(db *sql.DB, hub *Hub, table string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session := sessionFrom(r)
		id := r.PathValue("id")
		now := nowISO()
		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback()
		rev, err := bumpRev(tx, session.FamilyID)
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		res, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET deleted_at = ?, updated_at = ?, rev = ? WHERE id = ? AND family_id = ?`, table),
			now, now, rev, id, session.FamilyID)
		if err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "database error", http.StatusInternalServerError)
			return
		}
		hub.Broadcast(session.FamilyID)
		w.WriteHeader(http.StatusNoContent)
	}
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
