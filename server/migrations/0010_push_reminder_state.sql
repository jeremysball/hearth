-- 0010_push_reminder_state.sql
-- Persists per-reminder backoff state (due time, stage, last sent) so an
-- overdue push stops refiring on every 5-minute tick or new log entry —
-- see server/push.go's resolveScheduled/advanceStage.
CREATE TABLE IF NOT EXISTS push_reminder_state (
  family_id     TEXT NOT NULL,
  reminder_key  TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  stage         INTEGER NOT NULL DEFAULT 0,
  last_sent_at  TEXT,
  PRIMARY KEY (family_id, reminder_key)
);
