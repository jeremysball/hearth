package server

import (
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/binary"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

//go:embed schema.sql
var schemaFS embed.FS

// schemaMigrations records every migration version that has been applied
// to this database. The runner creates it on first run; the rest of the
// schema is the user's concern, not the migration system's.
const schemaMigrationsDDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`

// isDuplicateColumnError reports whether err is SQLite's "duplicate column
// name" — the sentinel for "this migration's effect is already on disk,
// just record it as applied." Used only by the runner; the rest of the
// codebase treats unknown SQL errors as fatal.
func isDuplicateColumnError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate column name")
}

// runMigrations applies every embedded migration file in lexicographic
// order whose version is not already recorded in schema_migrations. Each
// file runs in its own transaction: a half-applied file leaves the DB at
// the last fully-recorded version, and the next openDB resumes there.
//
// Migrations are forward-only. Removing or editing a migration that has
// already shipped to a live database is a one-way door — instead, add a
// new migration that performs the corrective change.
//
// The runner tolerates "duplicate column name" errors so that opening a
// pre-existing database whose tables already have the columns a migration
// would add still records that version as applied. Without this, opening
// a database created by a previous binary would fail with a "column
// already exists" on every additive migration.
func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(schemaMigrationsDDL); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	applied, err := loadAppliedMigrations(db)
	if err != nil {
		return err
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version, err := parseMigrationVersion(name)
		if err != nil {
			return err
		}
		if applied[version] {
			continue
		}
		content, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if err := applyMigration(db, version, string(content)); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
	}
	return nil
}

func loadAppliedMigrations(db *sql.DB) (map[int]bool, error) {
	rows, err := db.Query("SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("select schema_migrations: %w", err)
	}
	defer rows.Close()
	out := map[int]bool{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

// postMigrationHooks runs Go-side data rewrites a migration's plain SQL
// file can't express — e.g. computing an HMAC hash. Keyed by version, run
// inside the same transaction immediately after that version's SQL text
// applies, only the one time the migration is actually being applied (never
// on a startup where it's already recorded in schema_migrations). This is
// what makes the token-hash rewrite exactly-once instead of a per-startup
// rescan: by the time any request handler can insert a row, migration 11
// has already run, so every row present when the hook fires is legacy
// plaintext by construction.
var postMigrationHooks = map[int]func(tx *sql.Tx) error{
	11: hashLegacyTokens,
}

// hashLegacyTokens rewrites the plaintext values left in token_hash by
// 0011_token_hash.sql's column rename into HMAC-SHA256 hashes. Every row
// in these tables at this point predates token hashing entirely (this
// hook only ever runs once, guarded by schema_migrations), so it hashes
// unconditionally rather than filtering on a sentinel column.
func hashLegacyTokens(tx *sql.Tx) error {
	for _, table := range []string{"sessions", "invites", "launch_tokens", "pending_auth"} {
		rows, err := tx.Query(fmt.Sprintf(`SELECT token_hash FROM %s`, table))
		if err != nil {
			return fmt.Errorf("select %s: %w", table, err)
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
		for _, raw := range raws {
			if _, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET token_hash = ? WHERE token_hash = ?`, table),
				hashToken(raw), raw); err != nil {
				return fmt.Errorf("hash %s row: %w", table, err)
			}
		}
	}
	return nil
}

func applyMigration(db *sql.DB, version int, sqlText string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(sqlText); err != nil && !isDuplicateColumnError(err) {
		return err
	}
	if hook, ok := postMigrationHooks[version]; ok {
		if err := hook(tx); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", version, nowISO()); err != nil {
		return err
	}
	return tx.Commit()
}

func parseMigrationVersion(name string) (int, error) {
	i := strings.IndexByte(name, '_')
	if i <= 0 {
		return 0, fmt.Errorf("migration filename %q missing NNNN_ prefix", name)
	}
	v, err := strconv.Atoi(name[:i])
	if err != nil {
		return 0, fmt.Errorf("migration filename %q has non-integer prefix: %w", name, err)
	}
	return v, nil
}

// schemaHash returns the first 4 bytes of sha256(schema.sql) as a little-
// endian int32 (not uint32: PRAGMA user_version is SQLite's signed 32-bit
// integer, and a uint32 value at or above 2^31 silently fails to round-trip
// through it — SQLite stores whatever fits and reads back 0, permanently
// defeating the "did the schema change" check). 4 bytes is enough to act
// as that sentinel (collision odds ~1 in 2^32). Edit schema.sql, rebuild,
// next openDB produces a new hash.
func schemaHash() (int32, error) {
	b, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		return 0, fmt.Errorf("read schema.sql: %w", err)
	}
	sum := sha256.Sum256(b)
	return int32(binary.LittleEndian.Uint32(sum[:4])), nil
}

// verifySchemaHash refuses to start a database whose stamped schema
// version does not match this binary's schema.sql. Mismatch means the
// DB was last opened by a different binary and we have no idea what
// state it's in.
func verifySchemaHash(db *sql.DB) error {
	var stamped int64
	if err := db.QueryRow("PRAGMA user_version").Scan(&stamped); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	if stamped == 0 {
		// First-ever open: migrations already ran; stamp now.
		h, err := schemaHash()
		if err != nil {
			return err
		}
		_, err = db.Exec("PRAGMA user_version = " + strconv.FormatInt(int64(h), 10))
		return err
	}
	h, err := schemaHash()
	if err != nil {
		return err
	}
	if int32(stamped) != h {
		return fmt.Errorf("schema hash mismatch: db=0x%08x binary=0x%08x — refusing to start; update the binary or restore a compatible database", uint32(stamped), uint32(h))
	}
	return nil
}
