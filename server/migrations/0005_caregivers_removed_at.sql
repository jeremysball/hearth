-- 0005_caregivers_removed_at.sql
ALTER TABLE caregivers ADD COLUMN removed_at TEXT NOT NULL DEFAULT '';
