package main

import (
	"context"
	"database/sql"
	"net/http"
	"testing"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := openDB(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func withSession(r *http.Request, s SessionInfo) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxSessionKey, s))
}
