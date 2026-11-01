-- Resource access (artifact publishing plan, P6 — sharing).
--
-- One sharing model for work items and artifacts: members with a role
-- (view | edit; the author is work_items.creator_id and never a member row),
-- a general access setting per resource ("Only people invited" | "Anyone in
-- the team" | for artifacts only "Anyone with the link"), hashed public links,
-- and an audit trail. Design: docs/plans/2026-09-24-p6-sharing-design.md §2.
--
-- Data moves, then the old model is dropped:
--   work_item_participants  owner rows dropped (the creator is the author),
--                           participant -> edit, viewer -> view
--   share_tokens            live email invites -> pending members; bearer
--                           link tokens are dropped (nothing ever served
--                           /join, so none could be opened)
--   work_items.sharing_level  team | org -> 'team' + 'edit' (the write access
--                           those items already gave the org); public and
--                           private -> 'invited' (closes public = any signed-in
--                           user of any company)
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_public_links boolean NOT NULL DEFAULT true;
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_confluence_publishing boolean NOT NULL DEFAULT true;

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS general_access text NOT NULL DEFAULT 'invited';
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS general_role text NOT NULL DEFAULT 'view';

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS general_access text NOT NULL DEFAULT 'invited';
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS general_role text NOT NULL DEFAULT 'view';

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS ck_work_items_general_access;
ALTER TABLE work_items
  ADD CONSTRAINT ck_work_items_general_access CHECK (general_access IN ('invited', 'team'));
ALTER TABLE work_items DROP CONSTRAINT IF EXISTS ck_work_items_general_role;
ALTER TABLE work_items
  ADD CONSTRAINT ck_work_items_general_role CHECK (general_role IN ('view', 'edit'));

ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS ck_artifacts_general_access;
ALTER TABLE artifacts
  ADD CONSTRAINT ck_artifacts_general_access CHECK (general_access IN ('invited', 'team', 'link'));
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS ck_artifacts_general_role;
ALTER TABLE artifacts
  ADD CONSTRAINT ck_artifacts_general_role CHECK (general_role IN ('view', 'edit'));
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS ck_artifacts_link_is_view;
ALTER TABLE artifacts
  ADD CONSTRAINT ck_artifacts_link_is_view CHECK (general_access <> 'link' OR general_role = 'view');

-- Lets member and link rows reference (artifact, work item) together, so an
-- artifact member can never point at an artifact of a different work item.
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS uq_artifacts_id_work_item;
ALTER TABLE artifacts
  ADD CONSTRAINT uq_artifacts_id_work_item UNIQUE (id, work_item_id);

CREATE TABLE IF NOT EXISTS resource_members (
  id text PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  artifact_id text,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  invited_email text,
  role text NOT NULL,
  granted_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_resource_members_artifact FOREIGN KEY (artifact_id, work_item_id)
    REFERENCES artifacts(id, work_item_id) ON DELETE CASCADE,
  CONSTRAINT ck_resource_members_role CHECK (role IN ('view', 'edit')),
  CONSTRAINT ck_resource_members_subject CHECK ((user_id IS NULL) <> (invited_email IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_members_work_item_user
  ON resource_members (work_item_id, user_id)
  WHERE artifact_id IS NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_members_artifact_user
  ON resource_members (artifact_id, user_id)
  WHERE artifact_id IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_members_work_item_email
  ON resource_members (work_item_id, lower(invited_email))
  WHERE artifact_id IS NULL AND invited_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_members_artifact_email
  ON resource_members (artifact_id, lower(invited_email))
  WHERE artifact_id IS NOT NULL AND invited_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resource_members_user ON resource_members (user_id);
CREATE INDEX IF NOT EXISTS idx_resource_members_pending_email
  ON resource_members (lower(invited_email))
  WHERE user_id IS NULL;

CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  artifact_id text NOT NULL,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  comments_enabled boolean NOT NULL DEFAULT true,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT fk_share_links_artifact FOREIGN KEY (artifact_id, work_item_id)
    REFERENCES artifacts(id, work_item_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_share_links_live_artifact
  ON share_links (artifact_id)
  WHERE revoked_at IS NULL;

-- "Shared an artifact with you" opens the artifact, not its work item (an
-- artifact-only member cannot open the work item).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS artifact_id text REFERENCES artifacts(id) ON DELETE SET NULL;

-- Audit trail: no foreign keys, so a row outlives the resource it describes.
CREATE TABLE IF NOT EXISTS access_events (
  id text PRIMARY KEY,
  work_item_id text NOT NULL,
  artifact_id text,
  actor_id text,
  subject_user_id text,
  subject_email text,
  action text NOT NULL,
  role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_events_work_item
  ON access_events (work_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_access_events_artifact
  ON access_events (artifact_id, created_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_items' AND column_name = 'sharing_level'
  ) THEN
    UPDATE work_items
    SET general_access = 'team', general_role = 'edit'
    WHERE sharing_level IN ('team', 'org');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'work_item_participants'
  ) THEN
    INSERT INTO resource_members (id, work_item_id, user_id, role, granted_by, created_at)
    SELECT
      gen_random_uuid()::text,
      p.work_item_id,
      p.user_id,
      CASE p.role WHEN 'viewer' THEN 'view' ELSE 'edit' END,
      w.creator_id,
      now()
    FROM work_item_participants p
    JOIN work_items w ON w.id = p.work_item_id
    WHERE p.role <> 'owner' AND p.user_id <> w.creator_id
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'share_tokens') THEN
    INSERT INTO resource_members (id, work_item_id, invited_email, role, granted_by, created_at)
    SELECT DISTINCT ON (t.work_item_id, lower(t.invited_email))
      gen_random_uuid()::text,
      t.work_item_id,
      t.invited_email,
      CASE t.role WHEN 'viewer' THEN 'view' ELSE 'edit' END,
      t.created_by,
      t.created_at
    FROM share_tokens t
    WHERE t.invited_email IS NOT NULL
      AND t.revoked IS NOT TRUE
      AND (t.expires_at IS NULL OR t.expires_at > now())
    ORDER BY t.work_item_id, lower(t.invited_email), t.created_at DESC
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

DROP TABLE IF EXISTS work_item_participants;
DROP TABLE IF EXISTS share_tokens;
ALTER TABLE work_items DROP COLUMN IF EXISTS sharing_level;
