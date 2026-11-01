-- 0000_baseline.sql
--
-- Bootstrap for a FRESH database. Creates the 18 tables that predate the
-- hand-written migration set — the ones that only ever existed because
-- `drizzle-kit push` was run against a live database before this directory
-- was started. Nothing in the deploy path created them, so standing up a new
-- Neon project by the runbook produced a server that failed on its first
-- query: 0001-0008 ALTER and reference tables that were never there. This
-- file closes that gap. It is the same class of bug as the missing
-- `agent_plan_requests` migration (0008), one level up.
--
-- SAFE AND NO-OP ON AN EXISTING DATABASE. Every statement is guarded with
-- IF NOT EXISTS, so applying this to a database that already has these tables
-- changes nothing. Fresh deploys MUST start here, at 0000, and apply every
-- numbered file in order.
--
-- THIS FILE REPRODUCES THE SCHEMA AS IT WAS *BEFORE* 0001, NOT AS IT IS
-- TODAY. That is deliberate and it is the only shape that works: 0001-0008
-- are a replay of history, and several of their statements fail outright
-- against the current shape. Specifically, this file must NOT contain
--   * work_items.approval_policy / delivery_policy  — 0007 ADDs them
--   * work_item_participants.joined_via_token_id    — 0002 ADDs it
--   * chat_messages.session_id                      — 0005 ADDs it
--   * uq_artifact_versions_artifact_version         — 0003 ADDs it
--   * idx_artifacts_work_item, idx_presence_work_item,
--     idx_notifications_work_item, idx_share_tokens_work_item,
--     idx_participants_user                         — 0001 CREATEs them
--   * idx_participants_token                        — 0002 CREATEs it
--   * idx_messages_session                          — 0005 CREATEs it
-- because ADD COLUMN and CREATE INDEX have no IF NOT EXISTS guard in those
-- files and would abort the migration. Conversely it MUST contain
-- idx_messages_work_item and idx_artifact_versions_artifact, because 0001 and
-- 0003 DROP them unconditionally and a DROP of a nonexistent index errors.
-- The end state after 0000 -> 0008 is src/db/schema.ts; the coverage guard in
-- src/db/migration-coverage.test.ts enforces that every table in that file is
-- created by some migration here.
--
-- Foreign keys are declared inline and unnamed so Postgres assigns the
-- <table>_<column>_fkey names that 0001 drops by name, and carry NO ON DELETE
-- action — the schema genuinely shipped without them, which is the bug 0001
-- exists to fix. Do not "helpfully" add cascades here; 0001 would then drop
-- and re-add a constraint it did not expect to find, and an existing database
-- and a fresh one would diverge.
--
-- Statement order below resolves FK dependencies: referenced tables first.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0000_baseline.sql

-- ─── Identity (no dependencies) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_memberships (
  user_id text NOT NULL REFERENCES users(id),
  org_id text NOT NULL REFERENCES organizations(id),
  role text NOT NULL DEFAULT 'member',
  PRIMARY KEY (user_id, org_id)
);

-- ─── Work items and their children ──────────────────────────────────────────

-- version_number is monotonic and server-assigned: bumped on every mutation
-- and carried on the work_item_updated broadcast so clients can drop stale or
-- out-of-order events instead of clobbering newer state.
CREATE TABLE IF NOT EXISTS work_items (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  creator_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  workflow_phase text DEFAULT 'build',
  ticket_id text,
  ticket_provider text,
  ticket_url text,
  pr_number integer,
  pr_url text,
  repo_name text,
  branch_name text,
  agent_provider text,
  sharing_level text DEFAULT 'private',
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_item_participants (
  work_item_id text NOT NULL REFERENCES work_items(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'participant',
  PRIMARY KEY (work_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id),
  sender_id text REFERENCES users(id),
  sender_type text NOT NULL,
  sender_name text,
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 0001 drops this by name and recreates it with the id tiebreaker, so it has
-- to exist first. Two columns here, three there — that is the point of 0001.
CREATE INDEX IF NOT EXISTS idx_messages_work_item ON chat_messages (work_item_id, created_at);

-- ─── Artifacts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id),
  name text NOT NULL,
  content_type text NOT NULL DEFAULT 'markdown',
  content text NOT NULL DEFAULT '',
  status text DEFAULT 'in_progress',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifact_comments (
  id text PRIMARY KEY,
  artifact_id text NOT NULL REFERENCES artifacts(id),
  parent_comment_id text,
  author_id text NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  anchor_key text,
  anchor_text text,
  body text NOT NULL,
  resolved boolean DEFAULT false,
  resolved_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_artifact ON artifact_comments (artifact_id, created_at);

-- "trigger" is quoted only to keep it unambiguous to readers; it is a
-- non-reserved keyword in Postgres and the column name is plain lowercase.
CREATE TABLE IF NOT EXISTS artifact_versions (
  id text PRIMARY KEY,
  artifact_id text NOT NULL REFERENCES artifacts(id),
  document_name text NOT NULL,
  version_number integer NOT NULL,
  author_id text REFERENCES users(id),
  author_name text,
  label text,
  byte_size integer NOT NULL DEFAULT 0,
  "trigger" text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 0003 DROPs this index unconditionally (the unique constraint it adds is
-- backed by an index on the same leading columns, making this one redundant),
-- so a fresh database needs it to exist for that DROP to succeed. The guard
-- keeps this file a true no-op on a database that is already past 0003:
-- without it, re-running 0000 there would resurrect the redundant index that
-- 0003 deliberately removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_artifact_versions_artifact_version'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
      ON artifact_versions (artifact_id, version_number);
  END IF;
END $$;

-- ─── Presence ───────────────────────────────────────────────────────────────

-- Keyed by (user_id, work_item_id) so one user's windows on different work
-- items hold separate rows. work_item_id NULL is the "online, not scoped to a
-- work item" row. Two partial unique indexes rather than UNIQUE NULLS NOT
-- DISTINCT: the pinned drizzle-kit cannot introspect nulls-not-distinct, which
-- would make every future `drizzle-kit push` try to re-add the constraint and
-- fail.
CREATE TABLE IF NOT EXISTS presence (
  user_id text NOT NULL REFERENCES users(id),
  work_item_id text REFERENCES work_items(id),
  status text NOT NULL DEFAULT 'online',
  cursor_position jsonb,
  active_view text,
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_presence_user_work_item
  ON presence (user_id, work_item_id) WHERE work_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_presence_user_no_work_item
  ON presence (user_id) WHERE work_item_id IS NULL;

-- ─── Notifications ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text,
  work_item_id text REFERENCES work_items(id),
  read boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at);

-- ─── Sharing ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS share_tokens (
  id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id),
  created_by text NOT NULL REFERENCES users(id),
  token text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'viewer',
  expires_at timestamptz,
  revoked boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens (token);

CREATE TABLE IF NOT EXISTS team_invites (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  inviter_id text NOT NULL REFERENCES users(id),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON team_invites (email, status);

-- ─── Workflows ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  template text,
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES workflows(id),
  name text NOT NULL,
  stage_order integer NOT NULL,
  agent_provider text,
  agent_model text,
  output_type text,
  description text,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_gates (
  id text PRIMARY KEY,
  stage_id text NOT NULL REFERENCES workflow_stages(id),
  description text NOT NULL,
  gate_type text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Integrations ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS integrations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  account_name text,
  config jsonb DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_integrations_org_provider UNIQUE (org_id, provider)
);

-- ─── Team Pulse ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  user_id text NOT NULL REFERENCES users(id),
  summary text NOT NULL,
  pr_refs jsonb DEFAULT '[]'::jsonb,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_org_period ON team_pulse_summaries (org_id, period_end);
