package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRouterServesEmbeddedIndexByDefault(t *testing.T) {
	db := newParallelTestDB(t)
	mux := newRouter(db, newHub(), "", Config{}, newPushScheduler(db))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<html") {
		t.Fatalf("expected HTML body, got: %s", rec.Body.String())
	}
}

func TestRouterIndexHTMLIsNotCached(t *testing.T) {
	db := newParallelTestDB(t)
	mux := newRouter(db, newHub(), "", Config{}, newPushScheduler(db))

	for _, path := range []string{"/", "/index.html", "/join/some-token"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		mux.ServeHTTP(rec, req)

		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("path %s: Cache-Control = %q, want %q", path, got, "no-store")
		}
	}
}

func TestRouterServesFromDiskWhenStaticDirSet(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>disk override</html>"), 0644); err != nil {
		t.Fatal(err)
	}

	db := newParallelTestDB(t)
	mux := newRouter(db, newHub(), dir, Config{}, newPushScheduler(db))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	mux.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "disk override") {
		t.Fatalf("expected disk override body, got: %s", rec.Body.String())
	}
}
