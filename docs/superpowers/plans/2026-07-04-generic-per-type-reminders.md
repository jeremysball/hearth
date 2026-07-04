# Generic Per-Type Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the server's push-reminder scheduler (`familyReminders()` in `server/push.go`) so any activity type the user has configured with a reminder interval — via the existing "Add card" → generic interval flow — gets a scheduled push reminder, not just the two hardcoded `bottle` and `medicine` cases.

**Architecture:** The client already stores per-type intervals in `settings.cards.intervals` (e.g. `{"play": 6}`) and already computes "next due" for any such type client-side via `derive.nextForType()` (used by `genericCard()` on Home). That same `cards.intervals` map is already synced to the server as part of `cards_json` — no new column, no new client code. `familyReminders()` just needs to also read `cards_json`, loop over its `intervals` map, and — for each type not already handled by the bottle/medicine/hygiene special cases — compute a due time from that type's last log entry and, like bottle (not medicine/hygiene), suppress it during quiet hours.

**Tech Stack:** Go (`server/push.go`), Go tests (`server/push_test.go`). No client changes and no schema changes — this is a server-only PR.

## Global Constraints

- Conventional Commits for git messages.
- No version bump needed — this PR touches only `server/`, and per the project rule, Go-only diffs skip `scripts/bump-version.sh`.
- Decided now: a type gets a generic reminder purely by having an entry in `cards.intervals` — there is no separate per-type reminders on/off toggle in the UI today (only `naps`/`bottle`/`meds`/`hygiene` booleans exist), and adding one is out of scope here. The existing act of configuring an interval (via "Add card" or the interval edit sheet) is itself the opt-in, mirroring how the client's `genericCard()` already computes and shows a due time with no separate toggle check.
- Decided now: `bottle`, `medicine`, and `hygiene` are explicitly excluded from the generic loop even if they somehow appeared in `cards.intervals` (today `pickCard()` special-cases `bottle`/`medicine`/`bath` away from the generic interval flow — see `js/sheets.js:706` — so only `bath` is actually reachable via the generic path right now; `hygiene` isn't a type anywhere in the codebase yet and this exclusion is written in anticipation of the hygiene-activity plan, `docs/superpowers/plans/2026-07-04-hygiene-activity.md`, which gives it its own dedicated reminder loop in `familyReminders()` and adds it to `pickCard()`'s special-case list too). This PR assumes the hygiene-activity plan lands first, per the triage doc's suggested order — if it hasn't, drop `"hygiene"` from the `excluded` map below (it's a harmless no-op key either way, but the exclusion has no dedicated-path justification until that plan lands).
- Decided now: generic per-type reminders respect quiet hours, like `bottle` — these are convenience reminders (e.g. "log a diaper", "time to play"), not medicine's safety-critical case.

---

### Task 1: Extend `familyReminders()` to loop over configured generic types

**Files:**
- Modify: `server/push.go` (`familyReminders()` at push.go:279-319)
- Test: `server/push_test.go` (add cases mirroring `TestFamilyRemindersIncludesMedDuringQuietHours` at push_test.go:171-201 and `TestFamilyRemindersHonorsBottleDisabledAndQuietHours` at push_test.go:146-169)

**Interfaces:**
- Produces: `familyReminders()` additionally appends `pushReminder{Key: "<type>", ...}` for every key in `cardsSettings.Intervals` except `bottle`/`medicine`/`hygiene`.

- [ ] **Step 1: Write the failing tests**

Add to `server/push_test.go`, directly after `TestFamilyRemindersIncludesMedDuringQuietHours` (push_test.go:171-201):

```go
func TestFamilyRemindersIncludesGenericConfiguredType(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var found bool
	for _, r := range reminders {
		if r.Key == "play" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a generic 'play' reminder, got %+v", reminders)
	}
}

func TestFamilyRemindersSkipsGenericTypeDuringQuietHours(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', ?, ?, ?)`,
		"fam1",
		`{"bottle":false,"meds":false,"quietStart":"00:00","quietEnd":"23:59"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"play":2}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('p1', 'fam1', 'play', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-3*time.Hour).Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	for _, r := range reminders {
		if r.Key == "play" {
			t.Fatalf("generic 'play' reminder should be suppressed during quiet hours (00:00-23:59 is always quiet), got %+v", r)
		}
	}
}

func TestFamilyRemindersNeverDuplicatesBottleMedicineHygieneFromIntervals(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	// Defensive case: intervals somehow contains 'medicine' (shouldn't happen via the
	// UI, but the server must not double-schedule if it ever does).
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, ?, '{}', ?, ?, ?)`,
		"fam1",
		`[{"id":"m1","name":"Vitamin D","dose":"1","unit":"drop","everyH":24}]`,
		`{"bottle":false,"meds":true,"quietStart":"00:00","quietEnd":"00:00"}`,
		`{"bottle":true,"medicine":true,"order":["bottle","medicine"],"intervals":{"medicine":6}}`,
		now)
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('med1', 'fam1', 'medicine', ?, '{"medId":"m1"}', 'cg1', ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)

	s := newPushScheduler(db)
	reminders, err := s.familyReminders("fam1")
	if err != nil {
		t.Fatalf("familyReminders: %v", err)
	}
	var medCount int
	for _, r := range reminders {
		if r.Key == "med-m1" || r.Key == "medicine" {
			medCount++
		}
	}
	if medCount != 1 {
		t.Fatalf("expected exactly one medicine-derived reminder (from meds_json, not duplicated via intervals), got %d: %+v", medCount, reminders)
	}
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `go test ./server -run TestFamilyReminders -v`
Expected: `TestFamilyRemindersIncludesGenericConfiguredType` FAILs (no `"play"` key produced — `cards_json`/`intervals` isn't read at all yet); `TestFamilyRemindersSkipsGenericTypeDuringQuietHours` trivially PASSes already (nothing is ever scheduled yet, so the "not found" assertion is vacuously true — re-check this one after Step 4, not now); `TestFamilyRemindersNeverDuplicatesBottleMedicineHygieneFromIntervals` PASSes already for the same reason. Confirm at minimum that `TestFamilyRemindersIncludesGenericConfiguredType` fails.

- [ ] **Step 3: Add the generic-type loop to `familyReminders()`**

In `server/push.go`, replace `familyReminders()` (push.go:279-319) — add `cardsJSON` to the scanned columns and append a generic loop after the `meds` block (shown here assuming the hygiene block from the hygiene-activity plan has NOT landed yet; if it has, insert the new block after hygiene's instead, and add `"hygiene"` to the `excluded` map below):

```go
func (s *pushScheduler) familyReminders(familyID string) ([]pushReminder, error) {
	var bottleInterval float64
	var medsJSON, remindersJSON, cardsJSON string
	if err := s.db.QueryRow(`SELECT bottle_interval_h, meds_json, reminders_json, cards_json FROM settings WHERE family_id = ?`, familyID).Scan(&bottleInterval, &medsJSON, &remindersJSON, &cardsJSON); err != nil {
		return nil, err
	}
	settings := parseReminderSettings(remindersJSON)
	reminders := []pushReminder{}
	if settings.Bottle {
		var lastBottle string
		if err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'bottle' AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID).Scan(&lastBottle); err == nil {
			if t, err := time.Parse(time.RFC3339Nano, lastBottle); err == nil {
				at := t.Add(time.Duration(bottleInterval * float64(time.Hour)))
				if !isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
					reminders = append(reminders, pushReminder{Key: "bottle", Title: "Bottle due", Body: "Time for the next feed.", At: at})
				}
			}
		}
	}
	if settings.Meds {
		var meds []struct {
			ID     string  `json:"id"`
			Name   string  `json:"name"`
			Dose   string  `json:"dose"`
			Unit   string  `json:"unit"`
			EveryH float64 `json:"everyH"`
		}
		json.Unmarshal([]byte(medsJSON), &meds)
		for _, med := range meds {
			var lastMed string
			err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = 'medicine' AND json_extract(payload_json, '$.medId') = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, med.ID).Scan(&lastMed)
			if err != nil {
				continue
			}
			if t, err := time.Parse(time.RFC3339Nano, lastMed); err == nil {
				reminders = append(reminders, pushReminder{Key: "med-" + med.ID, Title: med.Name + " due", Body: med.Dose + med.Unit + " scheduled now.", At: t.Add(time.Duration(med.EveryH * float64(time.Hour)))})
			}
		}
	}
	var cards struct {
		Intervals map[string]float64 `json:"intervals"`
	}
	json.Unmarshal([]byte(cardsJSON), &cards)
	excluded := map[string]bool{"bottle": true, "medicine": true, "hygiene": true}
	for cardType, intervalH := range cards.Intervals {
		if excluded[cardType] {
			continue
		}
		var lastStart string
		err := s.db.QueryRow(`SELECT start FROM log_entries WHERE family_id = ? AND type = ? AND deleted_at IS NULL ORDER BY start DESC LIMIT 1`, familyID, cardType).Scan(&lastStart)
		if err != nil {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, lastStart)
		if err != nil {
			continue
		}
		at := t.Add(time.Duration(intervalH * float64(time.Hour)))
		if isQuietAt(at, settings.QuietStart, settings.QuietEnd) {
			continue
		}
		title := strings.ToUpper(cardType[:1]) + cardType[1:]
		reminders = append(reminders, pushReminder{Key: cardType, Title: title + " due", Body: "Time to log the next " + cardType + ".", At: at})
	}
	return reminders, nil
}
```

`strings` is already imported in `push.go` (push.go:12, used by `vapidSubscriber`), so no new import is needed.

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `go test ./server -run TestFamilyReminders -v`
Expected: all PASS, including the two that were vacuously passing before — re-verify `TestFamilyRemindersSkipsGenericTypeDuringQuietHours` specifically now reaches the `"play"` code path (add a temporary `t.Logf("%+v", reminders)` while checking manually if needed, then remove it) rather than just trivially passing on an empty scheduling list.

- [ ] **Step 5: Run the full Go suite**

Run: `go test ./server`
Expected: all PASS — the new `cards_json` column read is a pure addition; every existing `familyReminders`-adjacent test already inserts a `cards_json` value (even if just `'{}'`), and `json.Unmarshal` against `'{}'` into `cards.Intervals` (a nil map) is a no-op, so no existing test's expectations change.

- [ ] **Step 6: Commit**

```bash
git add server/push.go server/push_test.go
git commit -m "$(cat <<'EOF'
feat(push): schedule reminders for any activity type with a configured interval

EOF
)"
```

---

## Self-Review Notes

- Spec coverage: "extend `familyReminders()` ... to loop over every configured activity type with a reminder interval, not just those two hardcoded cases" — fully covered by Task 1's generic loop over `cards.intervals`.
- Decided (not deferred): opt-in is implicit (having an interval configured), no new toggle; bottle/medicine/hygiene are excluded defensively even though the UI never lets them reach `cards.intervals` in practice; quiet hours are respected for all generic types.
- No client changes: `cards.intervals` already exists and already syncs to the server via the existing `cards_json` PATCH path (`server/family.go` `patchSettingsRequest.Cards` / `handlePatchSettings`) — nothing in this plan needed to touch `js/store.js`, `js/sheets.js`, or `js/home.js`.
