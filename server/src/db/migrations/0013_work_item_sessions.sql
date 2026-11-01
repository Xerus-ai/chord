-- Cloud registry of a shared work item's agent CHAT threads (devstation-uka).
--
-- Unblocks the one unshipped piece of the Room-removal plan
-- (docs/plans/2026-09-15-feat-remove-room-shared-session-chats-plan.md):
-- `agent_sessions` is local SQLite and never reached the cloud, so a
-- participant's client could not know which threads exist. It kept one merged
-- work-item feed, and ws/event-handlers.ts stamped `session_id = null` on
-- every live participant message. With this table the owner's device
-- publishes its chat threads (PUT /work-items/:id/sessions, bulk replace,
-- same shape as 0012's worktrees) and a teammate gets one tab per thread.
--
-- ONLY chat sessions are published. Shell terminals are not shared
-- conversations, so there is no `kind` column — a filtered set makes it dead
-- weight. Several local columns are deliberately held back: `cwd` (an
-- absolute path on the owner's disk), `external_session_id` (a provider-side
-- resume handle), and `provision_status`/`respawn_count`/`last_turn_status`
-- (owner process-lifecycle internals). See packages/protocol/src/sessions.ts.
--
-- Bulk-replace semantics: the PUT upserts the listed rows and deletes any row
-- for that work item not listed, so the table always mirrors the owner's
-- current local chat-session set. `done` sessions ARE published — the
-- registry reports what exists and each client applies its own tab policy;
-- a row that vanished from the wire would be indistinguishable from one that
-- was never published at all.
--
-- IF NOT EXISTS-guarded like 0009/0010/0012: a database that already received
-- part of this file (crashed deploy, manual poke) can re-run it to
-- completion.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f 0013_work_item_sessions.sql

CREATE TABLE IF NOT EXISTS work_item_sessions (
  id                TEXT PRIMARY KEY,
  work_item_id      TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  agent_provider_id TEXT,
  title             TEXT,
  -- 'active' | 'suspended' | 'done', restating agent_sessions.status.
  status            TEXT NOT NULL DEFAULT 'active',
  -- Intentionally NOT a foreign key to work_item_worktrees: that table is
  -- maintained by its own whole-set replace (0012), which deletes rows the
  -- owner has dropped locally. A trimmed worktree must not cascade a live
  -- conversation out of existence. Resolved best-effort for a branch label.
  worktree_id       TEXT,
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_sessions_work_item
  ON work_item_sessions (work_item_id);
