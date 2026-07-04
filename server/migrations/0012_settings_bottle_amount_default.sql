-- 0012_settings_bottle_amount_default.sql
ALTER TABLE settings ADD COLUMN bottle_amount_default REAL NOT NULL DEFAULT 120;
