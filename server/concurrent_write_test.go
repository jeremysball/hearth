package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

// TestConcurrentWritesAllSucceed guards the desync fix in openDB
// (SetMaxOpenConns(1)). Before it, two caregivers logging at the same instant
// raced on SQLite's single write lock; busy_timeout does not wait out a
// write-lock upgrade, so bumpRev failed with SQLITE_BUSY, the write returned
// 500, and the entry never reached the server. Serializing the pool makes every
// concurrent write succeed. Uses a real file-backed WAL database (not the
// shared :memory: pool) so the write concurrency matches production.
func TestConcurrentWritesAllSucceed(t *testing.T) {
	if testing.Short() {
		t.Skip("write-contention test does many fsyncs; skipped under -short")
	}
	dir := t.TempDir()
	db, err := openDB(filepath.Join(dir, "concurrent.db"))
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	const writers = 4
	const perWriter = 40
	total := writers * perWriter

	var wg sync.WaitGroup
	var mu sync.Mutex
	var failures []string
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			cg := fmt.Sprintf("cg%d", w)
			for i := 0; i < perWriter; i++ {
				id := fmt.Sprintf("e_%d_%d", w, i)
				body := fmt.Sprintf(`{"id":%q,"type":"note","start":"2026-06-23T10:00:00Z"}`, id)
				req := httptest.NewRequest("PUT", "/api/entries/"+id, bytes.NewBufferString(body))
				req.SetPathValue("id", id)
				req = withSession(req, SessionInfo{CaregiverID: cg, FamilyID: "fam1"})
				rec := httptest.NewRecorder()
				handleUpsertEntry(db, hub, nil)(rec, req)
				if rec.Code != 204 {
					mu.Lock()
					failures = append(failures, fmt.Sprintf("%s: %d %s", id, rec.Code, rec.Body.String()))
					mu.Unlock()
				}
			}
		}(w)
	}
	wg.Wait()

	if len(failures) > 0 {
		t.Fatalf("%d/%d concurrent writes failed (regression: SQLITE_BUSY under contention): %v", len(failures), total, failures)
	}

	// Every write must be readable back in one full resync.
	req := httptest.NewRequest("GET", "/api/sync?since=-1", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cgX", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handleSync(db)(rec, req)
	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode sync: %v", err)
	}
	if len(resp.Entries) != total {
		t.Fatalf("full resync returned %d entries, want %d", len(resp.Entries), total)
	}
}
