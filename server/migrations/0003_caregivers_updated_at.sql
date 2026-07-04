-- 0003_caregivers_updated_at.sql
ALTER TABLE caregivers ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
