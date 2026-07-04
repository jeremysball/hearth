-- 0010_token_hash.sql
-- Rename the plaintext bearer-token column on every token table to
-- token_hash. The values themselves are rewritten to HMAC-SHA256 hashes by
-- the postMigrationHooks[10] Go hook (see migrate.go) in the same
-- transaction as this file — plain SQL can't compute the hash.
ALTER TABLE sessions RENAME COLUMN token TO token_hash;
ALTER TABLE invites RENAME COLUMN token TO token_hash;
ALTER TABLE launch_tokens RENAME COLUMN token TO token_hash;
ALTER TABLE pending_auth RENAME COLUMN token TO token_hash;
