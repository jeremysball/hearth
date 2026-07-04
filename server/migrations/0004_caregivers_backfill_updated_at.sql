-- 0004_caregivers_backfill_updated_at.sql
-- Backfill updated_at from created_at for legacy rows where updated_at was
-- just added in the previous migration and is therefore the empty string.
UPDATE caregivers SET updated_at = created_at WHERE updated_at = '';
