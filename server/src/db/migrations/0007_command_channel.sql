-- 0007_command_channel.sql
--
-- Command Channel Slice 1 (docs/plans/2026-07-12-command-channel-design.md §1).
--
-- `commands` is the durable cloud INBOX drained down to the owner's device —
-- the sync-queue outbox pattern pointed the other way. Rows are inserted by
-- tier-gated REST (POST /work-items/:id/commands), doorbelled to the
-- creator's device sockets over WS, then fetched/claimed/acked by the
-- owner's main process over REST. id is uuidv7 (server/src/lib/uuidv7.ts):
-- time-sortable, so "execute ascending id per work item" preserves issue
-- order. session_id is the OPAQUE local agent_sessions.id — deliberately no
-- FK until a cloud agent_sessions registry lands (deferred, beads
-- devstation-quh.6; same gap as chat_messages.session_id from 0005).
-- expires_at NULL = never expires server-side ('prompt' parks until the
-- agent runs); stamped at insert for the other kinds (interrupt +10min,
-- permission_response inherits its request's expires_at below).
--
-- `agent_permission_requests` is the outbound half of remote approvals: the
-- owner's device publishes the agent's tool-permission ask (sync-queue
-- entity, Slice 5), teammates answer with a permission_response command.
-- request_id is the SDK's requestId — the device is the id authority, so
-- it's the natural PK. resolved_by NULL = resolved locally by the owner app.
--
-- work_items gains the two policy axes: approval_policy gates WHO may insert
-- permission_response commands ('owner' default, 'participants' opt-in);
-- delivery_policy names the "does ambient chat wake the agent?" axis
-- ('manual' is the only v1 behavior, 'semi_live' reserved) so the future
-- mode rides the same rails without schema rework.
--
-- The (work_item_id, status, id) index serves the device fetch — "pending
-- commands for these work items, ascending id". The permission-request index
-- serves the participant card's "pending requests for this work item".
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0007_command_channel.sql

ALTER TABLE work_items
  ADD COLUMN approval_policy text NOT NULL DEFAULT 'owner',
  ADD COLUMN delivery_policy text NOT NULL DEFAULT 'manual';

CREATE TABLE commands (
  id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  session_id text,
  issuer_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  status_reason text,
  claimed_by_device text,
  claimed_at timestamptz,
  acked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_commands_work_item_status ON commands (work_item_id, status, id);

CREATE TABLE agent_permission_requests (
  request_id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  session_id text,
  tool_name text NOT NULL,
  input jsonb NOT NULL,
  options jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by text REFERENCES users(id),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_permission_requests_work_item ON agent_permission_requests (work_item_id, status);
