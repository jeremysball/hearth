package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHandleSyncReturnsEntriesChangedSinceTimestamp(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()

	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
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
}

func TestHandleSyncOmitsEntriesOlderThanSince(t *testing.T) {
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	req := httptest.NewRequest("GET", "/api/sync?since=2099-01-01T00:00:00Z", nil)
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
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqUp := httptest.NewRequest("PUT", "/api/entries/e1", bytes.NewBufferString(`{"id":"e1","type":"sleep","start":"2026-06-23T10:00:00Z"}`))
	reqUp.SetPathValue("id", "e1")
	reqUp = withSession(reqUp, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleUpsertEntry(db, hub)(httptest.NewRecorder(), reqUp)

	reqDel := httptest.NewRequest("DELETE", "/api/entries/e1", nil)
	reqDel.SetPathValue("id", "e1")
	reqDel = withSession(reqDel, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handleDeleteEntry(db, hub)(httptest.NewRecorder(), reqDel)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
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
	db := newTestDB(t)
	seedFamilyAndBaby(t, db, "fam1")
	hub := newHub()
	reqPatch := httptest.NewRequest("PATCH", "/api/baby", bytes.NewBufferString(`{"name":"Olive","theme":"boy"}`))
	reqPatch = withSession(reqPatch, SessionInfo{CaregiverID: "cg1", FamilyID: "fam1"})
	handlePatchBaby(db, hub)(httptest.NewRecorder(), reqPatch)

	req := httptest.NewRequest("GET", "/api/sync?since=2020-01-01T00:00:00Z", nil)
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
