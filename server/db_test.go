package main

import (
	"testing"
)

func TestOpenDBCreatesSchema(t *testing.T) {
	dir := t.TempDir()
	db, err := openDB(dir + "/test.db")
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	defer db.Close()

	tables := []string{"families", "babies", "caregivers", "sessions", "invites", "settings", "log_entries", "growth_entries"}
	for _, tbl := range tables {
		var count int
		err := db.QueryRow("SELECT count(*) FROM " + tbl).Scan(&count)
		if err != nil {
			t.Errorf("table %s: query failed: %v", tbl, err)
		}
	}
}

func TestNewIDIsUniqueAndNonEmpty(t *testing.T) {
	a, b := newID(), newID()
	if a == "" || b == "" {
		t.Fatal("newID returned empty string")
	}
	if a == b {
		t.Fatal("newID returned the same value twice")
	}
}

func TestNowISOIsRFC3339(t *testing.T) {
	s := nowISO()
	if len(s) < 20 {
		t.Fatalf("nowISO() = %q, looks too short for RFC3339Nano", s)
	}
}
