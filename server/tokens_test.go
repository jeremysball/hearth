package server

import (
	"database/sql"
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

func TestMigrateTokenHashRewritesLegacyRows(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE probe_tokens (token TEXT PRIMARY KEY, note TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO probe_tokens (token, note) VALUES ('raw-value', 'hello')`); err != nil {
		t.Fatal(err)
	}

	if err := migrateTokenHash(db, "probe_tokens"); err != nil {
		t.Fatalf("migrateTokenHash: %v", err)
	}

	var hash, note string
	var hashed int
	if err := db.QueryRow(`SELECT token_hash, token_hashed, note FROM probe_tokens WHERE note = 'hello'`).Scan(&hash, &hashed, &note); err != nil {
		t.Fatalf("querying migrated row: %v", err)
	}
	if hashed != 1 {
		t.Fatalf("token_hashed = %d, want 1", hashed)
	}
	if hash != hashToken("raw-value") {
		t.Fatalf("token_hash = %q, want hashToken(raw-value) = %q", hash, hashToken("raw-value"))
	}

	if err := migrateTokenHash(db, "probe_tokens"); err != nil {
		t.Fatalf("second migrateTokenHash call: %v", err)
	}
	var hash2 string
	db.QueryRow(`SELECT token_hash FROM probe_tokens WHERE note = 'hello'`).Scan(&hash2)
	if hash2 != hash {
		t.Fatalf("re-running migration changed the hash: %q != %q", hash2, hash)
	}
}

func TestMigrateTokenHashIsNoOpOnFreshSchema(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE probe_fresh (token_hash TEXT PRIMARY KEY, token_hashed INTEGER NOT NULL DEFAULT 0)`); err != nil {
		t.Fatal(err)
	}
	if err := migrateTokenHash(db, "probe_fresh"); err != nil {
		t.Fatalf("migrateTokenHash on fresh schema: %v", err)
	}
}
