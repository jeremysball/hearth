package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"strings"
)

// peppers holds the HMAC keys loaded from PEPPER at startup, current pepper
// first. Populated by loadPeppers() in Run() (see server/run.go) or by
// TestMain in tests (see server/testutil_test.go).
var peppers []string

// loadPeppers reads PEPPER from the environment and fatals on any invalid
// configuration. Called once at startup, right after loadConfig() returns.
func loadPeppers() []string {
	parsed, err := parsePeppers(os.Getenv("PEPPER"))
	if err != nil {
		log.Fatal(err)
	}
	return parsed
}

// parsePeppers validates a raw PEPPER value: comma-separated, no empty
// entries, every entry at least 32 bytes. First entry is the current pepper;
// the rest are fallbacks tried in order during a rotation window.
func parsePeppers(raw string) ([]string, error) {
	if raw == "" {
		return nil, fmt.Errorf("PEPPER must be set; generate one with `openssl rand -hex 32`")
	}
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		if p == "" {
			return nil, fmt.Errorf("PEPPER contains an empty entry")
		}
		if len(p) < 32 {
			return nil, fmt.Errorf("PEPPER entry shorter than 32 bytes; regenerate with `openssl rand -hex 32`")
		}
	}
	return parts, nil
}

// hashToken hashes plaintext with the current (first) pepper. Every INSERT
// uses this — new rows always carry the current pepper's hash.
func hashToken(plaintext string) string {
	return hashTokenWith(peppers[0], plaintext)
}

func hashTokenWith(pepper, plaintext string) string {
	h := hmac.New(sha256.New, []byte(pepper))
	h.Write([]byte(plaintext))
	return hex.EncodeToString(h.Sum(nil))
}

// allHashes returns plaintext hashed with every loaded pepper, in order,
// so a rotation-aware lookup can match a row hashed with any of them.
func allHashes(plaintext string) []string {
	out := make([]string, len(peppers))
	for i, p := range peppers {
		out[i] = hashTokenWith(p, plaintext)
	}
	return out
}

// lookupByToken runs query (which must contain exactly one %s placeholder
// for a `token_hash IN (...)` list, with token_hash as the first selected
// column) against every hash of plaintext, and returns the specific hash
// that matched along with the row's other columns scanned into dest.
//
// Callers that follow this read with a write (UPDATE/DELETE) MUST use the
// returned matchedHash, not a fresh hashToken(plaintext) call: during a
// rotation window a row can be found via a fallback pepper's hash, and
// recomputing with hashToken only ever produces the current pepper's hash,
// which would not match that row.
func lookupByToken(db *sql.DB, query string, plaintext string, dest ...any) (matchedHash string, err error) {
	hashes := allHashes(plaintext)
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(hashes)), ",")
	args := make([]any, len(hashes))
	for i, h := range hashes {
		args[i] = h
	}
	scanDest := append([]any{&matchedHash}, dest...)
	err = db.QueryRow(fmt.Sprintf(query, placeholders), args...).Scan(scanDest...)
	return matchedHash, err
}
