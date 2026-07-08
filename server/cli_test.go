package server

import (
	"net/http/httptest"
	"testing"
)

func TestCreateInviteCLIProducesJoinableInvite(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famCLI', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgCLI','famCLI','A','Parent',?)`, now)

	token, err := createInviteCLI(db, "famCLI")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("expected a non-empty token")
	}

	// Prove the token actually works by driving it through the real join
	// handler, not just inspecting the invites row.
	req := httptest.NewRequest("POST", "/api/join/"+token, nil)
	req.SetPathValue("token", token)
	rec := httptest.NewRecorder()
	handleJoinInvite(db, newHub())(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected join to succeed, got %d: %s", rec.Code, rec.Body.String())
	}

	var n int
	db.QueryRow(`SELECT COUNT(*) FROM caregivers WHERE family_id = 'famCLI' AND removed_at = ''`).Scan(&n)
	if n != 2 {
		t.Fatalf("expected the joined caregiver to be added to famCLI, got %d active caregivers", n)
	}
}

func TestListFamiliesCLIDoesNotPanic(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famCLI2', ?)`, now)
	db.Exec(`INSERT INTO babies (id, family_id, name, birthdate, theme, updated_at) VALUES ('babyCLI2','famCLI2','Baby','','girl',?)`, now)
	listFamiliesCLI(db) // must not panic; output isn't asserted here
}

func TestCreateInviteCLIRejectsUnknownFamily(t *testing.T) {
	db := newParallelTestDB(t)
	if _, err := createInviteCLI(db, "does-not-exist"); err == nil {
		t.Fatal("expected an error for an unknown family")
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM invites`).Scan(&n)
	if n != 0 {
		t.Fatalf("expected no invite row for unknown family, got %d", n)
	}
}
