package hearth

import "testing"

func TestStaticFSContainsFrontendEntrypoint(t *testing.T) {
	data, err := StaticFS.ReadFile("index.html")
	if err != nil {
		t.Fatalf("reading index.html from StaticFS: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("index.html is empty")
	}

	if _, err := StaticFS.ReadFile("js/app.js"); err != nil {
		t.Fatalf("reading js/app.js from StaticFS: %v", err)
	}
	if _, err := StaticFS.ReadFile("sw.js"); err != nil {
		t.Fatalf("reading sw.js from StaticFS: %v", err)
	}
}
