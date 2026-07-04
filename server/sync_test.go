package server

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleSyncReturnsEntriesOnFullResync(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	if len(resp.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d: %s", len(resp.Entries), rec.Body.String())
	}
	if resp.ServerRev != 1 {
		t.Fatalf("serverRev = %d, want 1", resp.ServerRev)
	}
}

func TestHandleSyncOmitsEntriesAlreadyDeliveredByRev(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqUp)

	// A client that already saw rev 1 (the entry above) polls again with
	// since=1: nothing new has happened, so it should get zero entries.
	req := httptest.NewRequest("GET", "/api/sync?since=1", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(resp.Entries))
	}
}

func TestHandleSyncIncludesDeletedAsTombstone(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqUp)

	reqDel := httptest.NewRequest("DELETE", "/api/entries/e1", nil)
	reqDel.SetPathValue("id", "e1")
	reqDel = withSession(reqDel, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleDeleteEntry(db, hub)(httptest.NewRecorder(), reqDel)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 1 {
		t.Fatalf("expected 1 (tombstoned) entry, got %d", len(resp.Entries))
	}
	var tomb struct {
		ID        string `json:"id"`
		DeletedAt string `json:"deletedAt"`
	}
	json.Unmarshal(resp.Entries[0], &tomb)
	if tomb.ID != "e1" || tomb.DeletedAt == "" {
		t.Errorf("expected tombstone with id=e1 and non-empty deletedAt, got %+v", tomb)
	}
}

func TestHandleSyncIncludesBabyWhenChanged(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqPatch := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","theme":"boy"}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Baby == nil {
		t.Fatal("expected baby to be included")
	}
	var baby struct {
		Name string `json:"name"`
	}
	json.Unmarshal(resp.Baby, &baby)
	if baby.Name != "Olive" {
		t.Errorf("baby.name = %q, want Olive", baby.Name)
	}
}

func TestHandleSyncReturnsPlayTypes(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqPatch := httptest.NewRequest("PATCH", "/api/settings", bytes.NewBufferString(`{"bottleIntervalH":3,"meds":[],"units":{},"reminders":{},"cards":{},"playTypes":["Tummy time","Reading"]}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchSettings(db, hub, nil)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if resp.Settings == nil {
		t.Fatal("expected settings to be included")
	}
	var settings struct {
		PlayTypes []string `json:"playTypes"`
	}
	json.Unmarshal(resp.Settings, &settings)
	if len(settings.PlayTypes) != 2 || settings.PlayTypes[0] != "Tummy time" || settings.PlayTypes[1] != "Reading" {
		t.Errorf("settings.playTypes = %v, want [Tummy time Reading]", settings.PlayTypes)
	}
}

func TestHandleSyncIncludesCaregiversWhenChanged(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	now := nowISO()
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', '', ?, '2026-01-01T00:00:00Z')`, now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, photo, updated_at, created_at, removed_at) VALUES ('cg2', 'fam1', 'Dad', 'Partner', '', ?, '2026-01-02T00:00:00Z', ?)`, now, now)
	db.Exec(`UPDATE caregivers SET photo = 'data:image/jpeg;base64,cg' WHERE id = 'cg1'`)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(resp.Caregivers) != 2 {
		t.Fatalf("expected caregivers in sync response, got %s", rec.Body.String())
	}
	var first, removed caregiverInfo
	json.Unmarshal(resp.Caregivers[0], &first)
	json.Unmarshal(resp.Caregivers[1], &removed)
	if first.ID != "cg1" || first.Photo != "data:image/jpeg;base64,cg" || !first.IsAdmin || first.RemovedAt != "" {
		t.Fatalf("first caregiver = %+v", first)
	}
	if removed.ID != "cg2" || removed.RemovedAt == "" {
		t.Fatalf("removed caregiver = %+v", removed)
	}
	if resp.CurrentCaregiverID != "cg1" {
		t.Fatalf("currentCaregiverId = %q, want cg1", resp.CurrentCaregiverID)
	}
}

// TestHandleSyncCursorSkipCannotLoseEntry replays the write/read interleave
// that used to lose entries permanently under the timestamp cursor (see
// docs/adr/0003-sync-cursor-revision-counter.md): a writer's row commits with
// a rev the reader's snapshot didn't include yet, while a concurrent reader's
// cursor advances past it. Because a row's rev and the family's rev_counter
// high-water mark commit atomically in the same transaction, this can no
// longer happen: a reader can never observe an advanced counter without also
// seeing the row backing it.
func TestHandleSyncCursorSkipCannotLoseEntry(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec := httptest.NewRecorder()
	handleSync(db)(rec, req)

	var resp syncResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decoding response: %v, body=%s", err, rec.Body.String())
	}
	found := false
	for _, raw := range resp.Entries {
		var e struct {
			ID string `json:"id"`
		}
		json.Unmarshal(raw, &e)
		if e.ID == "e1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("entry e1 missing from a full resync (serverRev=%d): %s", resp.ServerRev, rec.Body.String())
	}
	if resp.ServerRev != 1 {
		t.Fatalf("serverRev = %d, want 1 (row's rev and the counter must commit together)", resp.ServerRev)
	}
}

func TestHandleSyncInjectsCaregiverIDIntoEntries(t *testing.T) {
	db := newParallelTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"bottle","start":"2026-06-30T10:00:00Z","amount":120}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub, nil)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=", nil)
	req = withSession(req, SessionInfo{CaregiverID: "cg2", FamilyID: "fam1"})
	rec := httptest.NewRecorder()

	handleSync(db)(rec, req)

	var resp syncResponse
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Entries) != 1 {
		t.Fatalf("entries = %d, body=%s", len(resp.Entries), rec.Body.String())
	}
	var entry struct {
		CaregiverID string `json:"caregiverId"`
	}
	json.Unmarshal(resp.Entries[0], &entry)
	if entry.CaregiverID != "cg1" {
		t.Fatalf("caregiverId = %q, want cg1", entry.CaregiverID)
	}
}
