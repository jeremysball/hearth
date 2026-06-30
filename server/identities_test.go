package main

import "testing"

func TestIdentitiesAndPendingTablesExist(t *testing.T) {
	db := newParallelTestDB(t)
	if _, err := db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub1','cg1','a@b.c','t')`); err != nil {
		t.Fatalf("insert identity: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO pending_auth (token, provider, provider_user_id, email, target_family_id, current_family_id, current_caregiver_id, created_at) VALUES ('tok','google','sub2','x@y.z','famB','famA','cgA','t')`); err != nil {
		t.Fatalf("insert pending_auth: %v", err)
	}
	var cg string
	if err := db.QueryRow(`SELECT caregiver_id FROM identities WHERE provider='google' AND provider_user_id='sub1'`).Scan(&cg); err != nil {
		t.Fatalf("select identity: %v", err)
	}
	if cg != "cg1" {
		t.Errorf("caregiver_id = %q, want cg1", cg)
	}
}
