-- 0001_participant_view.sql
--
-- Participant work item view, Phase D/E (plan: emdash/docs/plans/
-- 2026-07-11-feat-participant-work-item-view-plan.md).
--
-- 1. Git snapshot tables: work_item_git_state (latest-snapshot metadata,
--    single row per work item) + work_item_git_files (per-file full
--    {original, modified} contents, fetched lazily by PK).
-- 2. ON DELETE actions on every work_items/artifacts child — the schema
--    shipped with none, so DELETE /work-items/:id always 500s (the owner
--    participant row inserted at create blocks it). notifications keeps its
--    rows (user-owned) with a nulled pointer.
-- 3. FK-column indexes — Postgres does not auto-index FK columns; cascade
--    deletes seq-scan the children without them. idx_messages_work_item is
--    rebuilt with the id tiebreaker to serve the keyset cursor's
--    (created_at, id) row comparison. idx_participants_user serves
--    /shared-with-me, which seq-scans participants today (the PK leads with
--    work_item_id).
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0001_participant_view.sql
--
-- Constraint names below were discovered from pg_constraint on staging
-- (2026-07-11) — all follow the <table>_<column>_fkey convention. If a
-- future environment drifts, re-discover before applying:
--
--   SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE contype = 'f'
--     AND confrelid IN ('work_items'::regclass, 'artifacts'::regclass);

-- ─── Git snapshot tables ─────────────────────────────────────────────────────

-- version mirrors work_items.version_number: integer, NOT bigint — pg bigint
-- serializes to a JS string and breaks numeric guards. Incremented in-SQL by
-- the PUT upsert, never read-then-write. captured_at is the owner's capture
-- time: staleness display + out-of-order rejection (two owner windows).
-- files holds metadata ONLY: [{path, status, additions, deletions,
-- content_omitted}] — contents live in work_item_git_files.
CREATE TABLE work_item_git_state (
  work_item_id text PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  captured_at timestamptz NOT NULL,
  branch_name text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Full pre/post-images as TEXT, not jsonb — opaque blobs, never queried by
-- content, fetched one at a time by PK. An added file has empty original; a
-- deleted file has empty modified.
CREATE TABLE work_item_git_files (
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  path text NOT NULL,
  original text NOT NULL,
  modified text NOT NULL,
  PRIMARY KEY (work_item_id, path)
);

-- ─── Delete actions (drop + re-add: Postgres cannot alter in place) ─────────

ALTER TABLE work_item_participants
  DROP CONSTRAINT work_item_participants_work_item_id_fkey,
  ADD CONSTRAINT work_item_participants_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE chat_messages
  DROP CONSTRAINT chat_messages_work_item_id_fkey,
  ADD CONSTRAINT chat_messages_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE artifacts
  DROP CONSTRAINT artifacts_work_item_id_fkey,
  ADD CONSTRAINT artifacts_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE presence
  DROP CONSTRAINT presence_work_item_id_fkey,
  ADD CONSTRAINT presence_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;

ALTER TABLE share_tokens
  DROP CONSTRAINT share_tokens_work_item_id_fkey,
  ADD CONSTRAINT share_tokens_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;

-- notifications rows are user-owned history; keep them, null the pointer.
-- Edge-Case §4's 404 fallback covers clicks on dangling notifications.
ALTER TABLE notifications
  DROP CONSTRAINT notifications_work_item_id_fkey,
  ADD CONSTRAINT notifications_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL;

-- Second level: without these, deleting a work item whose artifact carries
-- comments or versions still 500s at the artifacts cascade.
ALTER TABLE artifact_comments
  DROP CONSTRAINT artifact_comments_artifact_id_fkey,
  ADD CONSTRAINT artifact_comments_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE;

ALTER TABLE artifact_versions
  DROP CONSTRAINT artifact_versions_artifact_id_fkey,
  ADD CONSTRAINT artifact_versions_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_artifacts_work_item ON artifacts (work_item_id);
CREATE INDEX idx_presence_work_item ON presence (work_item_id);
CREATE INDEX idx_notifications_work_item ON notifications (work_item_id);
CREATE INDEX idx_share_tokens_work_item ON share_tokens (work_item_id);
CREATE INDEX idx_participants_user ON work_item_participants (user_id);

DROP INDEX idx_messages_work_item;
CREATE INDEX idx_messages_work_item ON chat_messages (work_item_id, created_at, id);
