package server

import (
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jeremysball/hearth"
)

// requireEmbeddedDist skips t when the embedded dist/ doesn't carry
// index.html — i.e. `npm run build` hasn't run on this checkout and
// dist/ is the bare .gitkeep placeholder. The Vite migration switched
// assets.go to //go:embed all:dist (from the pre-Vite //go:embed of
// specific source files), so a fresh checkout no longer carries an
// embedded index.html at all. CI, Docker, and tests/run.js all run
// `npm run build` before `go test`, so this skip is only triggered
// when a developer runs bare `go test ./server/...` against a pristine
// tree. Mirrors assets_test.go's requireDist for the same reason.
func requireEmbeddedDist(t *testing.T) {
	t.Helper()
	if _, err := fs.Stat(hearth.StaticFS, "index.html"); err != nil {
		t.Skipf("dist/ not built yet (%v); run `npm run build` first", err)
	}
}

func TestRouterServesEmbeddedIndexByDefault(t *testing.T) {
	requireEmbeddedDist(t)
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
	requireEmbeddedDist(t)
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

// Hashed Vite bundles under /static/* carry Cache-Control: immutable so the
// browser skips revalidation for a year. Unhashed pass-throughs under
// /assets/* and /icons/* stay cacheable by the file server's defaults
// (heuristic + ETag), since their filenames don't change when their bytes
// do. sw.js is special: it's an unhashed entry point that must revalidate
// so caregivers actually receive SW updates on reload, hence no-store.
func TestRouterHashedAssetsAreImmutable(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "static"))
	mustWriteFile(t, filepath.Join(dir, "static", "index-abc.js"), []byte("console.log('hi')"))
	mustWriteFile(t, filepath.Join(dir, "icons", "icon-192.png"), []byte("png"))
	mustWriteFile(t, filepath.Join(dir, "assets", "sky", "moon.webp"), []byte("webp"))

	db := newParallelTestDB(t)
	mux := newRouter(db, newHub(), dir, Config{}, newPushScheduler(db))

	wantImmutable := map[string]string{
		"/static/index-abc.js": "public, max-age=31536000, immutable",
	}
	for path, want := range wantImmutable {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		mux.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got != want {
			t.Errorf("path %s: Cache-Control = %q, want %q", path, got, want)
		}
	}

	// Unhashed pass-throughs must NOT carry an immutable header — only
	// content-hashed URLs are safe to pin for a year.
	for _, path := range []string{"/icons/icon-192.png", "/assets/sky/moon.webp"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		mux.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got == "public, max-age=31536000, immutable" {
			t.Errorf("path %s: must not be served as immutable (only content-hashed assets are)", path)
		}
	}
}

// Dev bypass (?dev=1, X-Hearth-Dev: 1, cfg.DevMode) must beat the immutable
// header so a hot edit→refresh loop never serves stale hashed bundles.
func TestRouterDevBypassOverridesImmutable(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "static"))
	mustWriteFile(t, filepath.Join(dir, "static", "index-abc.js"), []byte("console.log('hi')"))

	db := newParallelTestDB(t)

	cases := []struct {
		name string
		cfg  Config
		qs   string
		hdr  string
	}{
		{"cfg.DevMode", Config{DevMode: true}, "", ""},
		{"?dev=1", Config{}, "dev=1", ""},
		{"X-Hearth-Dev: 1", Config{}, "", "1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux := newRouter(db, newHub(), dir, tc.cfg, newPushScheduler(db))
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("GET", "/static/index-abc.js", nil)
			if tc.qs != "" {
				req.URL.RawQuery = tc.qs
			}
			if tc.hdr != "" {
				req.Header.Set("X-Hearth-Dev", tc.hdr)
			}
			mux.ServeHTTP(rec, req)
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("%s: Cache-Control = %q, want no-store (dev bypass must beat immutable)", tc.name, got)
			}
		})
	}
}

// sw.js is unhashed but must revalidate so caregivers actually receive SW
// updates. The cacheControl middleware never sees /sw.js (it's matched by
// the explicit mux route), but the explicit handler still pins no-store.
func TestRouterSwJsIsNotCached(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "sw.js"), []byte("// sw"))

	db := newParallelTestDB(t)
	mux := newRouter(db, newHub(), dir, Config{}, newPushScheduler(db))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/sw.js", nil)
	mux.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("/sw.js: Cache-Control = %q, want %q", got, "no-store")
	}
}

func mustMkdirAll(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path string, data []byte) {
	t.Helper()
	mustMkdirAll(t, filepath.Dir(path))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
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
