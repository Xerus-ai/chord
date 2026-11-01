-- 0002_participant_token_provenance.sql
--
-- SEC-4 (viewer read-only enforcement + share-link revoke cascade).
--
-- Adds provenance to work_item_participants: which share_token (if any)
-- created the row. Without this, revoking a share link left every
-- participant who joined through it with a standing access grant the
-- creator explicitly withdrew — the row survived the token.
--
-- ON DELETE SET NULL, not CASCADE: share_tokens rows are never hard-deleted
-- (revoke sets `revoked = true`), so this only matters if that ever changes;
-- either way a vanished token must not silently cascade-delete a
-- participant — the application-level revoke handler does that removal
-- explicitly and deliberately.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0002_participant_token_provenance.sql

ALTER TABLE work_item_participants
  ADD COLUMN joined_via_token_id text REFERENCES share_tokens(id) ON DELETE SET NULL;

CREATE INDEX idx_participants_token ON work_item_participants (joined_via_token_id);
