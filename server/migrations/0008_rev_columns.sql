-- 0008_rev_columns.sql
-- Per-family revision counter (families.rev_counter) and per-row rev stamp
-- on every sync-visible table. See docs/adr/0003-sync-cursor-revision-counter.md.
ALTER TABLE families ADD COLUMN rev_counter INTEGER NOT NULL DEFAULT 0;
ALTER TABLE babies ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE caregivers ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE log_entries ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE growth_entries ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
