# Notification Backoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed bug where an overdue reminder re-fires every 5 minutes (and on every new log entry in the family) instead of following a due → +15min → +1hr-later backoff, by persisting "how many times has this reminder already fired" state per reminder key.

**Root cause:** `familyReminders()` (`server/push.go:279-319`) always recomputes each reminder's due time fresh from the raw last-log-entry + interval, with no memory of whether it already fired. `ScheduleFamily()` (`server/push.go:203-233`) is called every 5 minutes by `ScheduleAll()`'s ticker (`server/run.go:56-62`) and also on every new log entry (`server/entries.go:65`). Each call cancels all of a family's pending in-memory timers and reschedules from scratch — so an overdue reminder (due time in the past → `delay = 0`, `server/push.go:221-224`) fires again immediately on every single call, which in practice means roughly every 5 minutes for as long as it stays unacknowledged.

**Architecture:** Add a small `push_reminder_state` table keyed by `(family_id, reminder_key)` storing the reminder's current `due_at`, an integer `stage` (0 = never sent, 1 = sent at `due_at`, 2 = sent at `due_at+15m`, 3 = sent at `due_at+75m`, fully escalated), and `last_sent_at`. `familyReminders()` itself is untouched — it still computes the *raw* due time for each key exactly as today. A new `resolveScheduled()` step sits between `familyReminders()` and the actual timer scheduling: for each raw reminder, it looks up persisted state; if the due time changed since last seen (the user logged the activity, pushing it into the future), it resets `stage` to 0 and schedules at the new due time; otherwise it computes the next backoff fire time from `stage` (or skips entirely once `stage` reaches 3). When a scheduled push actually fires, `stage` is incremented in the same row. Because repeated `ScheduleFamily()` calls before the next backoff fire time now recompute the *same* stage and therefore the *same* future fire time, the "refires every tick" bug disappears — only an actual timer firing advances `stage`.

**Tech Stack:** Go (`server/push.go`, `server/schema.sql`), Go tests (`server/push_test.go`). No client changes.

## Global Constraints

- Conventional Commits for git messages.
- No version bump needed — Go-only diffs skip `scripts/bump-version.sh`.
- A brand-new SQLite *table* only needs a `CREATE TABLE IF NOT EXISTS` in `schema.sql` — `server/db.go:46` runs the full embedded `schema.sql` unconditionally on every `openDB()` call (fresh or existing), so existing installs pick up new tables automatically on next restart. The two-part `schema.sql` + `db.go` `ALTER TABLE` migration pattern is only required when adding a *column* to an *already-existing* table (see `server/db.go:50-64` for that pattern) — not applicable here since this plan adds no new columns to any existing table.
- Decided now: the backoff schedule is exactly due → +15min → +75min (i.e. +15min, then +1hr after that), matching the triage decision verbatim ("due right at the reminder's due time, then re-fire at +15min if still missed, then +1hr after that"). After the third send, no further re-fires happen until the underlying due time changes (i.e. the activity gets logged, or its interval/config changes).
- Decided now: stale `push_reminder_state` rows (e.g. a deleted medicine's leftover key) are left in place, not pruned — they're inert once `familyReminders()` stops producing that key, and row count is bounded by the number of live reminder-eligible items per family. Pruning is out of scope (YAGNI).

---

### Task 1: `push_reminder_state` table and backoff resolution

**Files:**
- Modify: `server/schema.sql` (add a new table, near the other per-family tables)
- Modify: `server/push.go` (`pushReminder` struct at push.go:181-186, `pushScheduler.ScheduleFamily()` at push.go:203-233, `scheduleLocked()` at push.go:235-247; add `backoffFireAt()` and `pushScheduler.resolveScheduled()`/`advanceStage()`)
- Test: `server/push_test.go` (add cases for `resolveScheduled`/`advanceStage`/`backoffFireAt`, plus a `ScheduleFamily` no-refire regression test)

**Interfaces:**
- Produces: `backoffFireAt(due time.Time, stage int) (time.Time, bool)` — pure function, `ok=false` once `stage >= 3`. `(*pushScheduler).resolveScheduled(familyID string, raw []pushReminder) []pushReminder` — takes `familyReminders()`'s raw output, returns the backoff-adjusted list actually passed to scheduling. `(*pushScheduler).advanceStage(familyID string, rem pushReminder)` — called after a reminder fires. `pushReminder` gains a `DueAt time.Time` field (the original computed due time, used as the state row's dedupe key — distinct from `At`, which becomes the actual backoff-adjusted fire time).

- [ ] **Step 1: Write the failing tests**

Add to `server/push_test.go`, directly after `TestScheduleFamilyReplacesStaleTimers` (push_test.go:227-256):

```go
func TestBackoffFireAtSchedule(t *testing.T) {
	due := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		stage int
		want  time.Time
		ok    bool
	}{
		{0, due, true},
		{1, due.Add(15 * time.Minute), true},
		{2, due.Add(75 * time.Minute), true},
		{3, time.Time{}, false},
		{4, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := backoffFireAt(due, c.stage)
		if ok != c.ok || (ok && !got.Equal(c.want)) {
			t.Errorf("backoffFireAt(due, %d) = (%v, %v), want (%v, %v)", c.stage, got, ok, c.want, c.ok)
		}
	}
}

func TestResolveScheduledFirstSeenFiresAtDue(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)

	if len(out) != 1 || !out[0].At.Equal(due) || !out[0].DueAt.Equal(due) {
		t.Fatalf("resolveScheduled first-seen = %+v, want At=DueAt=%v", out, due)
	}
	var stage int
	var storedDue string
	db.QueryRow(`SELECT stage, due_at FROM push_reminder_state WHERE family_id = 'fam1' AND reminder_key = 'bottle'`).Scan(&stage, &storedDue)
	if stage != 0 || storedDue != due.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("persisted state = stage=%d due=%s, want stage=0 due=%s", stage, storedDue, due.UTC().Format(time.RFC3339Nano))
	}
}

func TestResolveScheduledAfterSendMovesToPlus15(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	first := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", first[0])

	second := s.resolveScheduled("fam1", raw)

	if len(second) != 1 || !second[0].At.Equal(due.Add(15*time.Minute)) {
		t.Fatalf("resolveScheduled after one send = %+v, want At=%v", second, due.Add(15*time.Minute))
	}
}

func TestResolveScheduledStopsAfterThirdSend(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])

	final := s.resolveScheduled("fam1", raw)
	if len(final) != 0 {
		t.Fatalf("expected no more reminders after 3 sends, got %+v", final)
	}
}

func TestResolveScheduledResetsWhenDueTimeChanges(t *testing.T) {
	db := newParallelTestDB(t)
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, nowISO())
	s := newPushScheduler(db)
	due := time.Now().UTC().Add(-time.Hour)
	raw := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: due}}

	out := s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])
	out = s.resolveScheduled("fam1", raw)
	s.advanceStage("fam1", out[0])

	newDue := time.Now().UTC().Add(2 * time.Hour)
	rawUpdated := []pushReminder{{Key: "bottle", Title: "Bottle due", Body: "b", At: newDue}}
	reset := s.resolveScheduled("fam1", rawUpdated)

	if len(reset) != 1 || !reset[0].At.Equal(newDue) {
		t.Fatalf("resolveScheduled after due-time change = %+v, want a fresh stage-0 reminder at %v", reset, newDue)
	}
	var stage int
	db.QueryRow(`SELECT stage FROM push_reminder_state WHERE family_id = 'fam1' AND reminder_key = 'bottle'`).Scan(&stage)
	if stage != 0 {
		t.Fatalf("stage after due-time change = %d, want 0 (reset)", stage)
	}
}

func TestScheduleFamilyStableKeyAcrossRepeatedTicksBeforeFire(t *testing.T) {
	db := newParallelTestDB(t)
	now := nowISO()
	db.Exec(`INSERT INTO families (id, created_at) VALUES ('fam1', ?)`, now)
	db.Exec(`INSERT INTO settings (family_id, bottle_interval_h, meds_json, units_json, reminders_json, cards_json, updated_at) VALUES (?, 3, '[]', '{}', '{"bottle":true,"meds":false,"quietStart":"00:00","quietEnd":"00:00"}', '{}', ?)`, "fam1", now)
	db.Exec(`INSERT INTO caregivers (id, family_id, display_name, role, created_at) VALUES ('cg1', 'fam1', 'Maya', 'Parent', ?)`, now)
	// Bottle interval is 3h; logged 1h ago, so it's due 2h from now — the
	// timer never fires during this test, so there's no race with
	// advanceStage() running inside the timer callback (see the
	// TestResolveScheduled* suite above for the actual backoff-stage
	// transitions, which exercise resolveScheduled/advanceStage directly).
	db.Exec(`INSERT INTO log_entries (id, family_id, type, start, payload_json, created_by, updated_at) VALUES ('b1', 'fam1', 'bottle', ?, '{}', 'cg1', ?)`,
		time.Now().UTC().Add(-1*time.Hour).Format(time.RFC3339Nano), now)

	s := newPushScheduler(db)
	var keys []string
	for i := 0; i < 3; i++ {
		s.ScheduleFamily("fam1")
		s.mu.Lock()
		var key string
		for k := range s.byFamily["fam1"] {
			key = k
		}
		count := len(s.byFamily["fam1"])
		s.mu.Unlock()
		if count != 1 {
			t.Fatalf("tick %d: expected exactly one pending bottle reminder, got %d", i, count)
		}
		keys = append(keys, key)
	}
	s.mu.Lock()
	for _, sp := range s.pending {
		sp.timer.Stop()
	}
	s.pending = map[string]scheduledPush{}
	s.byFamily = map[string]map[string]bool{}
	s.mu.Unlock()

	for i := 1; i < len(keys); i++ {
		if keys[i] != keys[0] {
			t.Fatalf("tick %d key %q differs from tick 0 key %q; repeated ScheduleFamily calls before the reminder fires must keep scheduling the same fire time", i, keys[i], keys[0])
		}
	}
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `go test ./server -run 'TestBackoffFireAtSchedule|TestResolveScheduled|TestScheduleFamilyStableKeyAcrossRepeatedTicksBeforeFire' -v`
Expected: all FAIL to compile — `backoffFireAt`, `resolveScheduled`, `advanceStage`, and `pushReminder.DueAt` don't exist yet.

- [ ] **Step 3: Add the table**

In `server/schema.sql`, add directly after the `log_entries` table and its indexes (schema.sql:61-73):

```sql
CREATE TABLE IF NOT EXISTS push_reminder_state (
  family_id     TEXT NOT NULL,
  reminder_key  TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  stage         INTEGER NOT NULL DEFAULT 0,
  last_sent_at  TEXT,
  PRIMARY KEY (family_id, reminder_key)
);
```

- [ ] **Step 4: Add `DueAt` to `pushReminder` and write `backoffFireAt()`**

In `server/push.go`, update the `pushReminder` struct (push.go:181-186):

```go
type pushReminder struct {
	Key   string
	Title string
	Body  string
	At    time.Time // actual fire time — may be delayed past DueAt by backoff
	DueAt time.Time // the reminder's true due time; the dedupe key for backoff state
}
```

Add directly after it:

```go
// backoffFireAt returns when a reminder at stage should next fire, given its
// due time. Stage 0 = never sent (fire at due), 1 = sent once (fire at
// due+15m), 2 = sent twice (fire at due+75m, i.e. 1h after the +15m send).
// Stage 3+ means it already fired 3 times; ok=false means don't reschedule.
func backoffFireAt(due time.Time, stage int) (time.Time, bool) {
	switch stage {
	case 0:
		return due, true
	case 1:
		return due.Add(15 * time.Minute), true
	case 2:
		return due.Add(75 * time.Minute), true
	default:
		return time.Time{}, false
	}
}
```

- [ ] **Step 5: Write `resolveScheduled()` and `advanceStage()`**

In `server/push.go`, add directly after `backoffFireAt()`:

```go
// resolveScheduled takes familyReminders()'s raw per-key due times and
// applies persisted backoff state: a reminder whose due time hasn't changed
// since it was last seen gets its next backoff fire time (or is dropped
// entirely once fully escalated); a reminder whose due time has moved
// (the activity was logged, or its interval changed) resets to stage 0.
func (s *pushScheduler) resolveScheduled(familyID string, raw []pushReminder) []pushReminder {
	out := make([]pushReminder, 0, len(raw))
	for _, r := range raw {
		dueISO := r.At.UTC().Format(time.RFC3339Nano)
		var storedDue string
		var stage int
		err := s.db.QueryRow(`SELECT due_at, stage FROM push_reminder_state WHERE family_id = ? AND reminder_key = ?`, familyID, r.Key).Scan(&storedDue, &stage)
		if err != nil || storedDue != dueISO {
			stage = 0
			if _, execErr := s.db.Exec(`INSERT INTO push_reminder_state (family_id, reminder_key, due_at, stage, last_sent_at) VALUES (?, ?, ?, 0, NULL)
				ON CONFLICT(family_id, reminder_key) DO UPDATE SET due_at = excluded.due_at, stage = 0, last_sent_at = NULL`, familyID, r.Key, dueISO); execErr != nil {
				log.Printf("push: resolveScheduled family=%s key=%s: persist state failed: %v", familyID, r.Key, execErr)
				continue
			}
		}
		fireAt, ok := backoffFireAt(r.At, stage)
		if !ok {
			continue
		}
		out = append(out, pushReminder{Key: r.Key, Title: r.Title, Body: r.Body, At: fireAt, DueAt: r.At})
	}
	return out
}

// advanceStage records that rem actually fired, incrementing its backoff
// stage. The due_at equality guard makes this a no-op if the underlying
// reminder's due time already moved on (e.g. a newer ScheduleFamily call
// reset it) between when this fire was scheduled and when it ran.
func (s *pushScheduler) advanceStage(familyID string, rem pushReminder) {
	dueISO := rem.DueAt.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.Exec(`UPDATE push_reminder_state SET stage = stage + 1, last_sent_at = ? WHERE family_id = ? AND reminder_key = ? AND due_at = ?`,
		nowISO(), familyID, rem.Key, dueISO); err != nil {
		log.Printf("push: advanceStage family=%s key=%s: %v", familyID, rem.Key, err)
	}
}
```

- [ ] **Step 6: Wire `resolveScheduled`/`advanceStage` into `ScheduleFamily`/`scheduleLocked`**

In `server/push.go`, update `ScheduleFamily()` (push.go:203-233):

```go
func (s *pushScheduler) ScheduleFamily(familyID string) {
	raw, err := s.familyReminders(familyID)
	if err != nil {
		log.Printf("push: scheduling family=%s failed: %v", familyID, err)
		return
	}
	reminders := s.resolveScheduled(familyID, raw)
	s.mu.Lock()
	for k := range s.byFamily[familyID] {
		if sp, ok := s.pending[k]; ok {
			sp.timer.Stop()
		}
		delete(s.pending, k)
	}
	if s.byFamily[familyID] == nil {
		s.byFamily[familyID] = map[string]bool{}
	}
	for _, rem := range reminders {
		key := familyID + ":" + rem.Key + ":" + rem.At.UTC().Format(time.RFC3339Nano)
		delay := time.Until(rem.At)
		if delay < 0 {
			delay = 0
		}
		s.byFamily[familyID][key] = true
		s.scheduleLocked(familyID, key, rem, delay)
	}
	if len(s.byFamily[familyID]) == 0 {
		delete(s.byFamily, familyID)
	}
	s.mu.Unlock()
	log.Printf("push: scheduled family=%s reminders=%d", familyID, len(reminders))
}
```

Update `scheduleLocked()` (push.go:235-247) to advance the backoff stage after sending:

```go
func (s *pushScheduler) scheduleLocked(familyID, key string, rem pushReminder, delay time.Duration) {
	reminder := rem
	s.pending[key] = scheduledPush{timer: time.AfterFunc(delay, func() {
		s.sendFamily(familyID, reminder)
		s.advanceStage(familyID, reminder)
		s.mu.Lock()
		delete(s.pending, key)
		delete(s.byFamily[familyID], key)
		if len(s.byFamily[familyID]) == 0 {
			delete(s.byFamily, familyID)
		}
		s.mu.Unlock()
	})}
}
```

`SendTestPush` (push.go:253-257) is untouched — it builds its own `pushReminder` inline with a zero `DueAt` and calls `time.AfterFunc` directly rather than `scheduleLocked`, so it never touches `push_reminder_state`, consistent with its existing doc comment that it "isn't tracked in pending/byFamily since it has nothing to reschedule."

- [ ] **Step 7: Run the tests again to confirm they pass**

Run: `go test ./server -run 'TestBackoffFireAtSchedule|TestResolveScheduled|TestScheduleFamilyStableKeyAcrossRepeatedTicksBeforeFire' -v`
Expected: all PASS.

- [ ] **Step 8: Run the full Go suite**

Run: `go test ./server`
Expected: all PASS. In particular, `TestScheduleFamilyReplacesStaleTimers` (push_test.go:227-256) still passes: its second `ScheduleFamily` call happens after a *new* log entry changes the bottle's due time, which `resolveScheduled` treats as a due-time change (reset to stage 0), so a fresh reminder is still scheduled exactly as before backoff existed.

- [ ] **Step 9: Commit**

```bash
git add server/schema.sql server/push.go server/push_test.go
git commit -m "$(cat <<'EOF'
fix(push): persist reminder backoff state so overdue pushes stop refiring every tick

EOF
)"
```

---

## Self-Review Notes

- Spec coverage: "Fire right at the reminder's due time, then re-fire at +15min if still missed, then +1hr after that" — `backoffFireAt` implements exactly due → due+15m → due+75m (75m = 15m + 1h), then stops. "Root cause... every 5-minute `ScheduleAll()` tick or any other entry logged anywhere in the family recomputes an overdue reminder's due-time and fires it again immediately" — fixed by `resolveScheduled` making repeated calls before the next backoff fire idempotent (same key, same delay), verified by the `TestResolveScheduled*` suite (direct stage transitions) plus `TestScheduleFamilyStableKeyAcrossRepeatedTicksBeforeFire` (repeated ticks before a fire keep the same scheduled key). "persisted 'last sent at' + 'next backoff step' state per reminder key (new table/column...)" — `push_reminder_state` table with `stage`/`last_sent_at`/`due_at` columns, keyed by `(family_id, reminder_key)`.
- Decided (not deferred): stale rows aren't pruned (YAGNI); a due-time change fully resets backoff to stage 0 (this is the "acknowledged by logging the activity" mechanism, and requires no new code beyond the existing due-time comparison).
- This plan makes no changes to `familyReminders()` itself (`push.go:279-319`) — it composes cleanly with both the hygiene-activity plan and the generic-per-type-reminders plan, whichever lands first or later, since both of those only change what `familyReminders()` returns as raw reminders, and `resolveScheduled()` treats all keys uniformly regardless of where they came from.
