package hearth

import (
	"encoding/json"
	"io/fs"
	"testing"
)

// requireDist returns a skipping t when dist/ is the bare .gitkeep
// placeholder (i.e. `npm run build` has never run on this checkout). The
// tests in this file assert that the production embed mirrors what Vite
// wrote into dist/, which is meaningless when dist/ only has a placeholder.
func requireDist(t *testing.T) {
	t.Helper()
	if _, err := fs.Stat(StaticFS, "."); err != nil {
		t.Skipf("dist/ not built yet (%v); run `npm run build` first", err)
	}
	if _, err := fs.ReadFile(StaticFS, "index.html"); err != nil {
		t.Skipf("dist/index.html missing — run `npm run build` to populate dist/ first")
	}
}

// Embedded dist/ contents that must exist for the production binary to
// boot. After the Vite migration these paths match what dist/index.html
// itself emits (`/static/<hash>.js`, `/manifest.webmanifest`, etc.) and
// what server/router.go serves, so any drift here surfaces as a 404 on
// first paint.
func TestStaticFSContainsFrontendEntrypoint(t *testing.T) {
	requireDist(t)
	data, err := fs.ReadFile(StaticFS, "index.html")
	if err != nil {
		t.Fatalf("reading index.html from StaticFS: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("index.html is empty")
	}

	if _, err := fs.ReadFile(StaticFS, "sw.js"); err != nil {
		t.Fatalf("reading sw.js from StaticFS: %v", err)
	}
	if _, err := fs.ReadFile(StaticFS, "manifest.webmanifest"); err != nil {
		t.Fatalf("reading manifest.webmanifest from StaticFS: %v", err)
	}
}

// Vite's build always emits the entry chunk as a hashed asset under
// dist/static/. Locate it via the embedded dist/.vite/manifest.json so
// this test stays stable across rebuilds (the exact hash changes every
// build).
func TestStaticFSContainsViteBuiltAssets(t *testing.T) {
	requireDist(t)
	raw, err := fs.ReadFile(StaticFS, ".vite/manifest.json")
	if err != nil {
		t.Fatalf("reading .vite/manifest.json from StaticFS: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal(".vite/manifest.json is empty")
	}
	var manifest map[string]struct {
		File string `json:"file"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf(".vite/manifest.json is not valid JSON: %v", err)
	}
	entry, ok := manifest["index.html"]
	if !ok {
		t.Fatalf(".vite/manifest.json has no index.html entry")
	}
	if entry.File == "" {
		t.Fatal("index.html manifest entry has empty file")
	}
	if _, err := fs.ReadFile(StaticFS, entry.File); err != nil {
		t.Fatalf("entry chunk %q listed in manifest is missing from StaticFS: %v", entry.File, err)
	}
}
