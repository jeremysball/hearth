-- 0009_rev_indices.sql
-- Sync pulls are per-family incremental scans of rev; this index makes
-- them O(log n + matching rows) instead of full-table. Lives in its own
-- migration because it depends on the rev columns added in 0008 — see
-- db.go's previous bug class where a CREATE INDEX on a not-yet-added
-- column failed the whole startup.
CREATE INDEX IF NOT EXISTS idx_caregivers_family_rev ON caregivers(family_id, rev);
CREATE INDEX IF NOT EXISTS idx_log_entries_family_rev ON log_entries(family_id, rev);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_rev ON growth_entries(family_id, rev);
