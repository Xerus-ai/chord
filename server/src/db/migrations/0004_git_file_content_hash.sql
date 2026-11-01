-- 0004_git_file_content_hash.sql
--
-- PERF-3 (git-state delta pushes via per-file content hashes).
--
-- work_item_git_files previously had no way to tell whether a file's content
-- actually changed since the last accepted push, so every PUT deleted every
-- row for the work item and reinserted whatever the client sent — full
-- delete+insert of every file's original/modified text on every push, even
-- when only one file changed. This column lets the PUT handler
-- (server/src/routes/git-state.ts) diff incoming files against what's
-- already stored and touch only the rows that actually changed.
--
-- Default '' rather than a backfilled real hash: '' can never equal a real
-- sha256 hex digest, so every pre-existing row is simply treated as changed
-- (re-uploaded) the first time a push touches it again — the safe direction,
-- never a false "unchanged" match that would leave stale content in place.
--
-- Mirrors drizzle/0001_new_black_queen.sql (drizzle-kit generate output, kept
-- in place for drizzle-kit's snapshot chain); this file is the applied set.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0004_git_file_content_hash.sql

ALTER TABLE work_item_git_files
  ADD COLUMN content_hash text NOT NULL DEFAULT '';
