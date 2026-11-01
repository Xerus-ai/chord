-- 0008_agent_plan_requests.sql
--
-- Command Channel: the plan half of remote approvals. 0007 shipped
-- `agent_permission_requests` and `commands`, and `src/db/schema.ts` gained
-- `agent_plan_requests` alongside them, but no migration ever created that
-- table — so every server that followed the deploy runbook answers
-- GET /work-items/:id/plan-requests with `relation "agent_plan_requests"
-- does not exist`, and the participant plan card can never load. This is the
-- missing half of 0007, split out rather than folded in so instances that
-- already applied 0007 have exactly one file left to run.
--
-- Shape mirrors `agent_permission_requests`: the owner's device publishes the
-- agent's proposed plan through the sync-queue and is the id authority, so
-- request_id (the SDK's requestId) is the natural PK. Plans carry
-- approve/reject only, so there is no options list — title/overview/steps are
-- the rendered card instead. resolved_by NULL = resolved locally by the owner
-- app rather than by a cloud user. expires_at is created_at + 24h, stamped by
-- the route; the device sweep in routes/commands-device.ts expires pending
-- rows past it, which is the query the (work_item_id, status) index serves
-- together with the participant card's "pending plans for this work item".
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0008_agent_plan_requests.sql

CREATE TABLE agent_plan_requests (
  request_id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  session_id text,
  title text NOT NULL,
  overview text NOT NULL,
  steps jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by text REFERENCES users(id),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_plan_requests_work_item ON agent_plan_requests (work_item_id, status);
