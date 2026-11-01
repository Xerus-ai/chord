-- Cloud sync of worktree metadata (workspace-shell-redesign plan, T0.8).
--
-- One row per `work_item_worktrees` local row, synced through the existing
-- sync-queue as a new 'worktrees' child entity keyed by work_item_id. This
-- is METADATA ONLY: branch, base branch, title, primary flag, status
-- bucket, diff counts, archive state. No file contents, no per-worktree git
-- state — D2 (confirmed in the plan) keeps cloud git-state per work item,
-- scoped to the primary worktree only; work_item_git_state is unchanged by
-- this migration.
--
-- Bulk-replace semantics: PUT /work-items/:id/worktrees upserts the listed
-- rows and deletes any row for that work item not listed, so the table
-- always mirrors the owner's current local worktree set (including
-- archived rows, which the client still sends so teammates can see recent
-- history rather than have sub-rows disappear silently).
--
-- IF NOT EXISTS-guarded like 0009/0010: a database that already received
-- part of this file (crashed deploy, manual poke) can re-run it to
-- completion.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f 0012_work_item_worktrees.sql

CREATE TABLE IF NOT EXISTS work_item_worktrees (
  id            TEXT PRIMARY KEY,
  work_item_id  TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  branch_name   TEXT,
  base_branch   TEXT,
  title         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  status_bucket TEXT NOT NULL DEFAULT 'idle',
  additions     INTEGER NOT NULL DEFAULT 0,
  deletions     INTEGER NOT NULL DEFAULT 0,
  -- false when the client's local diff stats were unavailable — additions/
  -- deletions are then a placeholder 0, not a real "no changes" answer.
  diff_known    BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_worktrees_work_item
  ON work_item_worktrees (work_item_id);
