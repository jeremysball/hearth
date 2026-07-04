-- 0006_settings_playtypes_json.sql
ALTER TABLE settings ADD COLUMN playtypes_json TEXT NOT NULL DEFAULT '[]';
