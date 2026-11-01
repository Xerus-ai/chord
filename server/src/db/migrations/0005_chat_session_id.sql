-- 0005_chat_session_id.sql
--
-- ARCH-1 (session identity on cloud chat — the traceability chain work item
-- → session → prompt → PR is currently broken because cloud chat_messages
-- carries no session identifier at all).
--
-- Adds a nullable session_id to chat_messages: the local agent_sessions.id
-- (client-side only table, src/main/db/schema-work-items.ts) that produced
-- the message. NOT FK-constrained — a cloud agent_sessions table and a
-- local→cloud sync path for those rows don't exist yet (that's scoped to
-- the upcoming command-channel project, deliberately not built here; see
-- schema.ts for the same note). An insert must not fail waiting on a
-- session row that may never reach the cloud. Capturing the value now,
-- ahead of the table, means the traceability data already exists on every
-- new message once that table and a real FK land — nothing here needs a
-- backfill later, only a constraint.
--
-- Column stays null for messages that never had a session: participant WS
-- chat (chat_message, human room chat) and single REST posts.
--
-- Mirrors drizzle/0003_slow_sue_storm.sql's `ALTER TABLE chat_messages ADD
-- COLUMN session_id` statement (drizzle-kit generate output, kept in place
-- for drizzle-kit's snapshot chain). That same generated migration also
-- created an agent_sessions table, which a follow-up generated migration
-- (drizzle/0005_legal_zeigeist.sql) drops — an in-repo scoping correction,
-- not a deploy step. This hand-written file is the applied set and was
-- never meant to include that table: it adds only what's below.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0005_chat_session_id.sql

ALTER TABLE chat_messages
  ADD COLUMN session_id text;

CREATE INDEX idx_messages_session ON chat_messages (session_id);
