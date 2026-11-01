-- Team billing foundation (Polar).
--
-- Two changes, one deploy step:
--
--   1. Billing columns on `organizations`. Chord bills per ORG (team seats),
--      not per user — unlike the Xerus integration this is modeled on, where
--      subscription state hangs off `users`. Every existing org becomes a
--      free-plan org with 5 seats, which is exactly the launch pricing for
--      teams that have never seen a checkout: the defaults ARE the backfill,
--      no UPDATE needed.
--
--   2. `polar_webhook_events`, the idempotency ledger. A webhook's state
--      change and its event row are written in the same transaction with
--      ON CONFLICT DO NOTHING on the primary key, so Polar redeliveries are
--      no-ops instead of double plan changes.
--
-- All statements are IF-NOT-EXISTS-guarded for the same reason as
-- 0009: a database that already received part of this file (crashed deploy,
-- manual poke) must be able to re-run it to completion.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f 0010_team_billing.sql

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS seat_limit integer NOT NULL DEFAULT 5;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS polar_customer_id text;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS polar_subscription_id text;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_email text;

CREATE TABLE IF NOT EXISTS polar_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  org_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
