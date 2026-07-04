package server

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"testing"
)

func TestMigrationsApplyAndStampHash(t *testing.T) {
	db, err := openDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var stamped int64
	if err := db.QueryRow("PRAGMA user_version").Scan(&stamped); err != nil {
		t.Fatal(err)
	}
	if stamped == 0 {
		t.Fatal("user_version not stamped after openDB")
	}
	expected, err := schemaHash()
	if err != nil {
		t.Fatal(err)
	}
	if int32(stamped) != expected {
		t.Fatalf("stamped 0x%08x, want 0x%08x", uint32(stamped), uint32(expected))
	}
}

func TestMigrationsAreReplayable(t *testing.T) {
	db, err := openDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// openDB already ran runMigrations. A second pass is a no-op.
	if err := runMigrations(db); err != nil {
		t.Fatalf("second runMigrations: %v", err)
	}

	rows, err := db.Query("SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	versions := []int{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, v)
	}
	want := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}
	if fmt.Sprint(versions) != fmt.Sprint(want) {
		t.Fatalf("versions = %v, want %v", versions, want)
	}
}

func TestRefusesHashMismatch(t *testing.T) {
	db, err := openDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec("PRAGMA user_version = 305419896"); err != nil { // 0x12345678 — fits in int32, won't match the real hash
		t.Fatal(err)
	}
	err = verifySchemaHash(db)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "schema hash mismatch") {
		t.Fatalf("expected hash mismatch error, got: %v", err)
	}
}

func TestLegacyDBAppliesForward(t *testing.T) {
	// A DB whose tables predate the rev columns — equivalent to a database
	// last opened by a binary from before commit 991e6fc.
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	bytes, err := migrationsFS.ReadFile("migrations/0001_initial.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(bytes)); err != nil {
		t.Fatalf("apply 0001: %v", err)
	}

	// Sanity: rev column is absent after only 0001.
	var hasRev int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('log_entries') WHERE name='rev'`).Scan(&hasRev); err != nil {
		t.Fatal(err)
	}
	if hasRev != 0 {
		t.Fatal("log_entries.rev should not exist after only 0001")
	}

	// Schema_migrations doesn't exist yet; runMigrations creates it.
	if err := runMigrations(db); err != nil {
		t.Fatalf("runMigrations on legacy DB: %v", err)
	}

	// After migrations, rev exists and every version is recorded.
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('log_entries') WHERE name='rev'`).Scan(&hasRev); err != nil {
		t.Fatal(err)
	}
	if hasRev != 1 {
		t.Fatal("log_entries.rev should exist after migrations")
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 12 {
		t.Fatalf("schema_migrations has %d rows, want 12", count)
	}
}

func TestMigrationsAreOrdered(t *testing.T) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	var versions []int
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		v, err := parseMigrationVersion(e.Name())
		if err != nil {
			t.Fatalf("parse %s: %v", e.Name(), err)
		}
		versions = append(versions, v)
	}
	sort.Ints(versions)
	for i := 1; i < len(versions); i++ {
		if versions[i] != versions[i-1]+1 {
			t.Fatalf("non-monotonic versions: %v", versions)
		}
	}
}

// TestSchemaSQLMatchesMigrations is the consistency test: schema.sql
// describes the canonical end state, the migrations are the path to
// reach it from scratch. If they diverge, the canonical description has
// drifted from the migration history and either side is wrong.
func TestSchemaSQLMatchesMigrations(t *testing.T) {
	// DB A: run all migrations.
	a, err := openDB(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	// DB B: apply only schema.sql.
	b, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	b.SetMaxOpenConns(1)
	schemaBytes, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.Exec(string(schemaBytes)); err != nil {
		t.Fatalf("apply schema.sql: %v", err)
	}

	aTables := userTables(t, a)
	bTables := userTables(t, b)
	if fmt.Sprint(aTables) != fmt.Sprint(bTables) {
		t.Fatalf("table set differs:\n  migrations: %v\n  schema.sql: %v", aTables, bTables)
	}

	for _, tbl := range aTables {
		aCols, err := tableInfo(a, tbl)
		if err != nil {
			t.Fatal(err)
		}
		bCols, err := tableInfo(b, tbl)
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprint(aCols) != fmt.Sprint(bCols) {
			t.Fatalf("table %s columns differ:\n  migrations: %v\n  schema.sql: %v", tbl, aCols, bCols)
		}
	}

	for _, tbl := range aTables {
		aIdx, err := indexList(a, tbl)
		if err != nil {
			t.Fatal(err)
		}
		bIdx, err := indexList(b, tbl)
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprint(aIdx) != fmt.Sprint(bIdx) {
			t.Fatalf("table %s index list differs:\n  migrations: %v\n  schema.sql: %v", tbl, aIdx, bIdx)
		}
	}
}

func userTables(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		out = append(out, n)
	}
	return out
}

func tableInfo(db *sql.DB, table string) ([]string, error) {
	// Sort by name, not cid: ALTER TABLE adds columns at the end, so the
	// physical order produced by running the migrations can differ from
	// the declaration order in schema.sql. What we care about is that
	// both describe the same set of (name, type, notnull, default, pk)
	// tuples — not their position.
	rows, err := db.Query(fmt.Sprintf(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(%q) ORDER BY name`, table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name, typ string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&name, &typ, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		out = append(out, fmt.Sprintf("%s|%s|%d|%v|%d", name, typ, notnull, dflt.String, pk))
	}
	return out, nil
}

func indexList(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf(`SELECT name, "unique", origin FROM pragma_index_list(%q) ORDER BY name`, table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var name, origin string
		var u int
		if err := rows.Scan(&name, &u, &origin); err != nil {
			return nil, err
		}
		out = append(out, fmt.Sprintf("%s|%d|%s", name, u, origin))
	}
	return out, nil
}
