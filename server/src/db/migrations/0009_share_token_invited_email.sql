-- 0009_share_token_invited_email.sql
--
-- `share_tokens.invited_email` and its index exist in `src/db/schema.ts` and in
-- `server/drizzle/0007_pending_share_invites.sql`, but no file in this
-- deployable set ever created them — and nothing in `server/drizzle/` is on the
-- deploy path. So every database built by following DEPLOYMENT.md §4 is missing
-- the column outright. This is the same failure as the missing
-- `agent_plan_requests` migration (0008), one level down: a COLUMN added to the
-- schema with no migration behind it, which the table-level coverage guard in
-- src/db/migration-coverage.test.ts cannot see.
--
-- SYMPTOM THIS FIXES — operator-facing, because it does not look like a
-- migration problem from the outside:
--
--   ERROR: column "invited_email" does not exist
--
-- Reproduced by applying 0000-0008 to an empty Postgres 16 and running the
-- query from server/src/server.ts:319 verbatim. That query lives in
-- sync-profile, which runs on SIGN-IN for every user who has an email, so on an
-- affected database this is sign-in-breaking, not a degraded corner. It also
-- breaks share-by-email to an invitee who does not yet have an account
-- (routes/sharing.ts:401 selects on the column, :426 inserts it).
--
-- BOTH STATEMENTS ARE GUARDED, and that is load-bearing rather than defensive
-- habit. The column's state in production is genuinely unknown: it reached the
-- drizzle chain on 2026-07-18, so any environment where someone ran
-- `drizzle-kit push` after that date already has it, while any environment
-- following the runbook does not. The §4 loop now runs psql with
-- ON_ERROR_STOP=1 (without it a failed migration exits 0 and is silently
-- skipped), which means an unguarded `ADD COLUMN` would abort the whole
-- remaining deploy on exactly the already-pushed databases we most need to
-- finish cleanly. IF NOT EXISTS makes this file correct in both worlds and a
-- true no-op in the second — the same argument as 0000_baseline.sql.
--
-- Not folded into 0000: that file is a no-op on any database that already has
-- the 18 baseline tables, so putting this there would fix only freshly created
-- databases and leave every existing deployment broken while silently diverging
-- the two. A column fix has to be its own numbered step to reach both.
--
-- Nullable with no backfill, matching schema.ts. NULL is the correct and
-- meaningful value for every existing row: a token only carries an invited
-- email when it was created by share-by-email for someone without an account
-- yet. Tokens from plain share links have no invitee and must stay NULL — the
-- sign-up auto-accept sweep matches on a concrete email, so NULL rows are
-- correctly never swept.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f 0009_share_token_invited_email.sql

ALTER TABLE share_tokens
  ADD COLUMN IF NOT EXISTS invited_email text;

-- Serves the sign-up auto-accept sweep in server.ts (sync-profile): "every
-- non-revoked token addressed to this email".
CREATE INDEX IF NOT EXISTS idx_share_tokens_invited_email
  ON share_tokens (invited_email);
