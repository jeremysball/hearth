package server

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestMain(m *testing.M) {
	os.Setenv("PEPPER", strings.Repeat("t", 40))
	peppers = loadPeppers()
	os.Exit(m.Run())
}

// hashForTest computes the same hash the production hashToken function
// would, so test fixtures can seed token_hash columns with values that
// match what a real handler looks up.
func hashForTest(t *testing.T, plaintext string) string {
	t.Helper()
	return hashToken(plaintext)
}

var testDBState struct {
	sync.Mutex
	db *sql.DB
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	testDBState.Lock()
	t.Cleanup(testDBState.Unlock)
	if testDBState.db == nil {
		db, err := openDB(":memory:")
		if err != nil {
			t.Fatalf("openDB: %v", err)
		}
		testDBState.db = db
	}
	resetTestDB(t, testDBState.db)
	return testDBState.db
}

func resetTestDB(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{
		"pending_auth",
		"identities",
		"growth_entries",
		"launch_tokens",
		"log_entries",
		"settings",
		"invites",
		"sessions",
		"caregivers",
		"babies",
		"families",
	} {
		if _, err := db.Exec("DELETE FROM " + table); err != nil {
			t.Fatalf("reset %s: %v", table, err)
		}
	}
}

func newParallelTestDB(t *testing.T) *sql.DB {
	t.Helper()
	t.Parallel()
	return newTestDB(t)
}

func withSession(r *http.Request, s SessionInfo) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxSessionKey, s))
}
