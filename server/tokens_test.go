package server

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func TestParsePeppersRejectsEmpty(t *testing.T) {
	if _, err := parsePeppers(""); err == nil {
		t.Fatal("expected error for empty PEPPER")
	}
}

func TestParsePeppersRejectsEmptyEntry(t *testing.T) {
	a := strings.Repeat("a", 32)
	b := strings.Repeat("b", 32)
	if _, err := parsePeppers(a + ",," + b); err == nil {
		t.Fatal("expected error for empty entry between commas")
	}
}

func TestParsePeppersRejectsShortEntry(t *testing.T) {
	if _, err := parsePeppers("tooshort"); err == nil {
		t.Fatal("expected error for entry shorter than 32 bytes")
	}
}

func TestParsePeppersPreservesOrder(t *testing.T) {
	first := strings.Repeat("a", 32)
	second := strings.Repeat("b", 32)
	got, err := parsePeppers(first + "," + second)
	if err != nil {
		t.Fatalf("parsePeppers: %v", err)
	}
	if len(got) != 2 || got[0] != first || got[1] != second {
		t.Fatalf("got %v, want [%q %q]", got, first, second)
	}
}

func TestHashTokenWithDeterministicAndPepperDependent(t *testing.T) {
	pepperA := strings.Repeat("a", 32)
	pepperB := strings.Repeat("b", 32)
	h1 := hashTokenWith(pepperA, "same-token")
	h2 := hashTokenWith(pepperA, "same-token")
	if h1 != h2 {
		t.Fatalf("hashTokenWith not deterministic: %q != %q", h1, h2)
	}
	if len(h1) != 64 {
		t.Fatalf("len(hash) = %d, want 64", len(h1))
	}
	for _, c := range h1 {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Fatalf("hash contains non-hex char %q in %q", c, h1)
		}
	}
	if h3 := hashTokenWith(pepperB, "same-token"); h3 == h1 {
		t.Fatal("hash should change when pepper changes")
	}
}

func TestHashTokenUsesCurrentPepper(t *testing.T) {
	if hashToken("abc") != hashTokenWith(peppers[0], "abc") {
		t.Fatal("hashToken should hash with peppers[0]")
	}
}

func TestAllHashesOrderMatchesPeppers(t *testing.T) {
	orig := peppers
	peppers = []string{strings.Repeat("a", 32), strings.Repeat("b", 32)}
	t.Cleanup(func() { peppers = orig })

	hashes := allHashes("plain")
	if len(hashes) != 2 {
		t.Fatalf("len(allHashes) = %d, want 2", len(hashes))
	}
	if hashes[0] != hashToken("plain") {
		t.Fatalf("allHashes[0] = %q, want hashToken result %q", hashes[0], hashToken("plain"))
	}
	if hashes[1] != hashTokenWith(peppers[1], "plain") {
		t.Fatalf("allHashes[1] does not match fallback pepper's hash")
	}
}

func TestLookupByTokenMatchesFallbackPepper(t *testing.T) {
	orig := peppers
	peppers = []string{strings.Repeat("c", 32), strings.Repeat("d", 32)}
	t.Cleanup(func() { peppers = orig })

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE rotation_probe (token_hash TEXT PRIMARY KEY, label TEXT)`); err != nil {
		t.Fatal(err)
	}

	fallbackHash := hashTokenWith(peppers[1], "old-token")
	if _, err := db.Exec(`INSERT INTO rotation_probe (token_hash, label) VALUES (?, ?)`, fallbackHash, "legacy"); err != nil {
		t.Fatal(err)
	}

	var label string
	matched, err := lookupByToken(db, `SELECT token_hash, label FROM rotation_probe WHERE token_hash IN (%s)`, "old-token", &label)
	if err != nil {
		t.Fatalf("lookupByToken: %v", err)
	}
	if matched != fallbackHash {
		t.Fatalf("matchedHash = %q, want %q", matched, fallbackHash)
	}
	if label != "legacy" {
		t.Fatalf("label = %q, want legacy", label)
	}
}

func TestLookupByTokenNoMatchReturnsErrNoRows(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE rotation_probe2 (token_hash TEXT PRIMARY KEY, label TEXT)`); err != nil {
		t.Fatal(err)
	}
	var label string
	_, err = lookupByToken(db, `SELECT token_hash, label FROM rotation_probe2 WHERE token_hash IN (%s)`, "nope", &label)
	if err != sql.ErrNoRows {
		t.Fatalf("err = %v, want sql.ErrNoRows", err)
	}
}

// TestMigration10HashesLegacyPlaintextTokens is the regression test for the
// double-hash-on-restart bug: a database that predates migration 10 has
// plaintext values in the (about to be renamed) token column. openDB must
// hash each one exactly once, and importantly must NOT touch it again on a
// second open — there is no per-row sentinel column anymore, so the only
// thing preventing a second hash pass is schema_migrations recording
// version 10 as applied.
func TestMigration10HashesLegacyPlaintextTokens(t *testing.T) {
	for _, table := range []string{"sessions", "invites", "launch_tokens", "pending_auth"} {
		t.Run(table, func(t *testing.T) {
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
			if _, err := db.Exec(fmt.Sprintf(`UPDATE %s SET token = 'raw-value' WHERE 1=0`, table)); err != nil {
				t.Fatal(err)
			}

			var insert string
			switch table {
			case "sessions":
				insert = `INSERT INTO sessions (token, caregiver_id, family_id, created_at, last_seen_at) VALUES ('raw-value', 'c', 'f', 'now', 'now')`
			case "invites":
				insert = `INSERT INTO invites (token, family_id, created_by, expires_at) VALUES ('raw-value', 'f', 'c', 'later')`
			case "launch_tokens":
				insert = `INSERT INTO launch_tokens (token, caregiver_id, family_id, expires_at) VALUES ('raw-value', 'c', 'f', 'later')`
			case "pending_auth":
				insert = `INSERT INTO pending_auth (token, provider, provider_user_id, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES ('raw-value', 'google', 'u', 'f1', 'f2', 'c', 'now')`
			}
			if _, err := db.Exec(insert); err != nil {
				t.Fatalf("insert legacy row: %v", err)
			}

			if err := runMigrations(db); err != nil {
				t.Fatalf("runMigrations: %v", err)
			}

			var hash string
			if err := db.QueryRow(fmt.Sprintf(`SELECT token_hash FROM %s`, table)).Scan(&hash); err != nil {
				t.Fatalf("querying migrated row: %v", err)
			}
			if hash != hashToken("raw-value") {
				t.Fatalf("token_hash = %q, want hashToken(raw-value) = %q", hash, hashToken("raw-value"))
			}

			// The regression case: re-running migrations (e.g. a server
			// restart) must be a no-op, not a second hash pass.
			if err := runMigrations(db); err != nil {
				t.Fatalf("second runMigrations: %v", err)
			}
			var hash2 string
			if err := db.QueryRow(fmt.Sprintf(`SELECT token_hash FROM %s`, table)).Scan(&hash2); err != nil {
				t.Fatal(err)
			}
			if hash2 != hash {
				t.Fatalf("restart re-hashed the token: %q != %q", hash2, hash)
			}
		})
	}
}

// TestFreshInstallSessionSurvivesRestart is the end-to-end version of the
// same regression: create a session the normal way (through createSession,
// which writes an already-hashed token_hash), then simulate a restart by
// opening the same DB again, and confirm the plaintext cookie still
// resolves via lookupByToken. Before the fix, a per-row token_hashed=0
// default plus an unconditional rescan on every startup would double-hash
// this row and silently invalidate the session.
func TestFreshInstallSessionSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/hearth.db"

	db, err := openDB(path)
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO families (id, created_at) VALUES ('f', 'now')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO caregivers (id, family_id, display_name, created_at) VALUES ('c', 'f', 'Alex', 'now')`); err != nil {
		t.Fatal(err)
	}
	token, err := createSession(db, "c", "f")
	if err != nil {
		t.Fatalf("createSession: %v", err)
	}
	db.Close()

	db2, err := openDB(path)
	if err != nil {
		t.Fatalf("re-openDB (restart): %v", err)
	}
	defer db2.Close()

	var label string
	if _, err := lookupByToken(db2, `SELECT token_hash, family_id FROM sessions WHERE token_hash IN (%s)`, token, &label); err != nil {
		t.Fatalf("session did not survive restart: %v", err)
	}
}
