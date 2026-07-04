package server

import (
	"context"
	"database/sql"
	"net/http"
	"sync"
	"testing"
)

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
