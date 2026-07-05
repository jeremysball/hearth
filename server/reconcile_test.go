package server

import "testing"

func TestReconcileLinksAnonymousDevice(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"}
	res, err := reconcile(db, "google", "sub-new", "a@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "linked" || res.FamilyID != "famA" || res.CaregiverID != "cgA" {
		t.Fatalf("got %+v", res)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM identities WHERE provider='google' AND provider_user_id='sub-new'`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected identity row, got %d", n)
	}
}

func TestReconcileRestoresOnCleanDevice(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	res, err := reconcile(db, "google", "sub-b", "b@b.c", nil) // clean device, no session
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" || res.FamilyID != "famB" || res.CaregiverID != "cgB" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileConflictWhenBothHaveData(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	// Family A has data on this device.
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('e1','famA','diaper','t','{}','cgA',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"}
	res, err := reconcile(db, "google", "sub-b", "b@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "conflict" || res.TargetFamily != "famB" || res.CurrentFamily != "famA" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileRestoresWhenDeviceHasNoData(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famA', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgA','famA','A','Parent',?)`, now)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famB', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cgB','famB','B','Parent',?)`, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-b','cgB','b@b.c',?)`, now)
	cur := &SessionInfo{CaregiverID: "cgA", FamilyID: "famA"} // A empty
	res, err := reconcile(db, "google", "sub-b", "b@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "restored" || res.FamilyID != "famB" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileRemovedWhenIdentityCaregiverRemoved(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famC', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at, removed_at) VALUES ('cgC','famC','C','Parent',?,?)`, now, now)
	db.Exec(`INSERT INTO identities (provider, provider_user_id, caregiver_id, email, created_at) VALUES ('google','sub-c','cgC','c@b.c',?)`, now)
	res, err := reconcile(db, "google", "sub-c", "c@b.c", nil) // clean device, no session
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "removed" {
		t.Fatalf("got %+v", res)
	}
}

func TestReconcileRemovedWhenCurrentSessionCaregiverRemoved(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('famD', ?)`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at, removed_at) VALUES ('cgD','famD','D','Parent',?,?)`, now, now)
	cur := &SessionInfo{CaregiverID: "cgD", FamilyID: "famD"}
	res, err := reconcile(db, "google", "sub-new-d", "d@b.c", cur)
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != "removed" {
		t.Fatalf("got %+v", res)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM identities WHERE provider='google' AND provider_user_id='sub-new-d'`).Scan(&n)
	if n != 0 {
		t.Fatalf("expected no identity row to be created for a removed caregiver's session, got %d", n)
	}
}
