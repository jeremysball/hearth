# Numbered schema migrations

Replace the ad-hoc `ALTER TABLE` chain in `db.go` with a replayable, ordered
migration sequence. Closes the bug class where a `CREATE INDEX` referencing a
not-yet-added column makes an existing DB fail to open. Adds a `schema.sql`
hash stamp on `PRAGMA user_version` so "is this DB fully migrated to this
binary's schema" is a one-integer read.

## Shape

```
server/
  db.go                  openDB calls runMigrations then stamps the hash
  migrate.go             runMigrations, schema_migrations table, hash helpers
  migrations/            one .sql file per version, applied in order
    0001_initial.sql
    0002_caregivers_photo.sql
    0003_caregivers_updated_at.sql
    0004_caregivers_backfill_updated_at.sql
    0005_caregivers_removed_at.sql
    0006_settings_playtypes_json.sql
    0007_rev_columns.sql
    0008_rev_indices.sql
    0009_settings_hygiene_json.sql
  schema.sql             DELETED — its content moves to 0001_initial.sql
```

`schema.sql` is kept as a hand-written description of the current shape. The
migrations are the steps to reach it from scratch. A consistency test asserts
the two agree.

## Migration order

Mirrors the git history of the ad-hoc `ALTER TABLE` chain. Each file is one
logical change; the version number is the file's integer prefix.

| # | File | What it does |
|---|---|---|
| 1 | `0001_initial.sql` | All 12 `CREATE TABLE` and 7 `CREATE INDEX` statements with later-added columns **removed**: `caregivers.photo / updated_at / removed_at / rev`, `settings.playtypes_json / rev / hygiene_json`, `rev_counter` on families, `rev` on babies |
| 2 | `0002_caregivers_photo.sql` | `ALTER TABLE caregivers ADD COLUMN photo TEXT NOT NULL DEFAULT ''` |
| 3 | `0003_caregivers_updated_at.sql` | `ALTER TABLE caregivers ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''` |
| 4 | `0004_caregivers_backfill_updated_at.sql` | `UPDATE caregivers SET updated_at = created_at WHERE updated_at = ''` |
| 5 | `0005_caregivers_removed_at.sql` | `ALTER TABLE caregivers ADD COLUMN removed_at TEXT NOT NULL DEFAULT ''` |
| 6 | `0006_settings_playtypes_json.sql` | `ALTER TABLE settings ADD COLUMN playtypes_json TEXT NOT NULL DEFAULT '[]'` |
| 7 | `0007_rev_columns.sql` | Six `ALTER TABLE … ADD COLUMN rev …` (families, babies, settings, caregivers, log_entries, growth_entries) |
| 8 | `0008_rev_indices.sql` | Three `CREATE INDEX IF NOT EXISTS … ON (family_id, rev)` — the ones that caused today's bug |
| 9 | `0009_settings_hygiene_json.sql` | `ALTER TABLE settings ADD COLUMN hygiene_json TEXT NOT NULL DEFAULT '[]'` |

The "duplicate column name" sentinel string-matching in `db.go` is replaced
by a single check in the runner: if a migration errors with that string, the
column already exists from a prior run, so record the version as applied and
move on. This is what makes the runner idempotent on a database that already
has the canonical shape (the live `hearth.db` case).

## Runner shape (`server/migrate.go`)

```
//go:embed migrations/*.sql
var migrationsFS embed.FS

func runMigrations(db *sql.DB) error
  1. CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
  2. Read applied versions into a set
  3. For each embedded .sql file in sorted order:
     - parse version from filename prefix
     - if applied, skip
     - BEGIN; Exec content; if error is "duplicate column name", record as applied; else return error
     - INSERT INTO schema_migrations(version, applied_at); COMMIT

func stampSchemaHash(db *sql.DB) error
  - sha := sha256.Sum256(embeddedSchemaSQL)
  - hash := binary.LittleEndian.Uint32(sha[:4])
  - db.Exec("PRAGMA user_version = " + strconv.FormatUint(uint64(hash), 10))

func openDB(path string) (*sql.DB, error)
  - pragmas (WAL, busy_timeout)
  - runMigrations(db)
  - read user_version, compare to current hash
    - mismatch: log.Fatalf with both hex values
    - match: return db
  - first run on a fresh DB: stamp after migrations
```

`PRAGMA user_version` carries the **schema.sql hash** of the binary that last
opened the DB. `schema_migrations.version` records **which migrations have
run**. They serve different purposes; both are read on every open.

The hash is computed at runtime from the embedded `schema.sql` bytes. No
generated file, no constant to bump, no `go generate` step. Edit
`schema.sql`, rebuild, next open produces a new hash.

## Tests (`server/migrate_test.go`)

- `TestMigrationsApplyAndStampHash` — fresh DB, open, assert `user_version`
  matches the runtime hash of the embedded `schema.sql`.
- `TestMigrationsAreReplayable` — call `runMigrations` twice on the same DB,
  assert no error and no duplicate rows in `schema_migrations`.
- `TestRefusesHashMismatch` — pre-set `user_version` to a wrong value, call
  `openDB`, expect an error mentioning the mismatch.
- `TestLegacyDBAppliesForward` — pre-create a DB with 0001's shape (no `rev`
  columns), call `openDB`, assert the migration runner applies 0002-0009 and
  the end state matches the canonical shape.
- `TestMigrationsAreOrdered` — `fs.ReadDir("migrations")` returns files in
  monotonically increasing version order; a `0007_*.sql` after `0010_*.sql`
  is a CI failure.
- `TestSchemaSQLMatchesMigrations` — open two fresh `:memory:` databases. Run
  migrations on A, apply `schema.sql` on B. Compare `sqlite_master` contents
  (table and index CREATE statements, ignoring `sqlite_autoindex_*`). They
  must be equal. This is the consistency test between the canonical
  description and the migration history.

## Compatibility with the live `hearth.db`

The live DB has `PRAGMA user_version = 0` and all canonical columns/indices
(verified after PR #68). On first start of the new binary:

- `user_version == 0` → fresh path.
- `runMigrations` runs all 9. Each is a no-op (tables exist, columns
  exist, indices exist) or a tolerated duplicate-column error that records
  the version as applied.
- `user_version` gets stamped with the runtime hash.
- Done. The live DB survives the transition.

`resetTestDB` in `testutil_test.go` does not need to change. The test DB
schema is set up once per process (when `newTestDB` first opens it) and
persists across tests. The `schema_migrations` table and `user_version`
stamp are part of that setup, not the per-test reset.

## What this kills

- 5 ad-hoc `ALTER TABLE` calls in `db.go`
- 3 ad-hoc `CREATE INDEX` calls in `db.go`
- The `strings.Contains(err.Error(), "duplicate column name")` sentinel
- `server/schema.sql` (its content moves to `migrations/0001_initial.sql`)
- The `//go:embed schema.sql` directive

## What it adds

- 9 SQL files (~50 lines total)
- `server/migrate.go` (~80 lines)
- `server/migrate_test.go` (~120 lines)
- 5 lines in `testutil_test.go` if needed for clean reset
- Net: roughly a wash on LOC, much higher signal-to-noise on the schema
  history
