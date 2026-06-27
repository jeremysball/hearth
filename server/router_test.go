package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRouterServesEmbeddedIndexByDefault(t *testing.T) {
	db := newTestDB(t)
	mux := newRouter(db, newHub(), "", Config{})

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

func TestRouterServesFromDiskWhenStaticDirSet(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>disk override</html>"), 0644); err != nil {
		t.Fatal(err)
	}

	db := newTestDB(t)
	mux := newRouter(db, newHub(), dir, Config{})

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
