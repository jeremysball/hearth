CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  rev_counter INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'girl',
  photo TEXT,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_babies_family ON babies(family_id);

CREATE TABLE IF NOT EXISTS caregivers (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Parent',
  photo TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  removed_at TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_caregivers_family ON caregivers(family_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_family_rev ON caregivers(family_id, rev);

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
  hygiene_json TEXT NOT NULL DEFAULT '[]',
  units_json TEXT NOT NULL DEFAULT '{}',
  reminders_json TEXT NOT NULL DEFAULT '{}',
  cards_json TEXT NOT NULL DEFAULT '{}',
  playtypes_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  type TEXT NOT NULL,
  start TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_log_entries_family_updated ON log_entries(family_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_log_entries_family_rev ON log_entries(family_id, rev);

CREATE TABLE IF NOT EXISTS launch_tokens (
  token        TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL,
  family_id    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

CREATE TABLE IF NOT EXISTS growth_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id),
  date TEXT NOT NULL,
  weight_kg REAL,
  height_cm REAL,
  head_cm REAL,
  note TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_updated ON growth_entries(family_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_growth_entries_family_rev ON growth_entries(family_id, rev);

CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  caregiver_id      TEXT NOT NULL REFERENCES caregivers(id),
  email             TEXT,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_caregiver ON identities(caregiver_id);

CREATE TABLE IF NOT EXISTS pending_auth (
  token                TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  provider_user_id     TEXT NOT NULL,
  email                TEXT,
  target_family_id     TEXT NOT NULL,
  current_family_id    TEXT NOT NULL,
  current_caregiver_id TEXT NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id),
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_caregiver ON push_subscriptions(caregiver_id);
