-- 0014_settings_home_quick_order_json.sql
ALTER TABLE settings ADD COLUMN home_quick_order_json TEXT NOT NULL DEFAULT '[]';
