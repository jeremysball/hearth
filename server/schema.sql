CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'girl',
  photo TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_babies_family ON babies(family_id);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Parent',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_caregivers_family ON caregivers(family_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id),
  family_id TEXT NOT NULL REFERENCES families(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  family_id TEXT PRIMARY KEY REFERENCES families(id),
  bottle_interval_h REAL NOT NULL DEFAULT 3,
  meds_json TEXT NOT NULL DEFAULT '[]',
  units_json TEXT NOT NULL DEFAULT '{}',
  reminders_json TEXT NOT NULL DEFAULT '{}',
  cards_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  type TEXT NOT NULL,
  start TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_entries_family_updated ON log_entries(family_id, updated_at);

CREATE TABLE IF NOT EXISTS growth_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  date TEXT NOT NULL,
  weight_kg REAL,
  height_cm REAL,
  head_cm REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_updated ON growth_entries(family_id, updated_at);
