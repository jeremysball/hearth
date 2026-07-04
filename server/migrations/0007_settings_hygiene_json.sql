-- 0007_settings_hygiene_json.sql
ALTER TABLE settings ADD COLUMN hygiene_json TEXT NOT NULL DEFAULT '[]';
