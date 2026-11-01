-- Notification facts (shared-items step 2, N1).
--
-- A notification stores facts, not a finished sentence; the app builds the
-- sentence from the roster (design §4, step 2 plan §2 N1):
--
--   actor_user_id  who acted (sharer, mentioner, commenter, inviter); NULL for
--                  a comment made through a public link ("Someone with the
--                  link") and once the actor's account is deleted
--   org_id         the team a team_invite is for
--   comment_id     the artifact comment an artifact_comment opens
--   message_id     the chat message a mention scrolls to (chat is not in
--                  Postgres, so no foreign key)
--   excerpt        the role, message or comment text, at most 200 characters
--
-- The rows written before this hold only sentences (title/body) and no actor,
-- so they cannot become facts: they are deleted (step 2 plan §1, decision 1).
-- title and body become optional here and are dropped by 0021, once no
-- producer writes them and no client reads them (expand, then contract, so
-- every slice between the two builds and runs).
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_id text REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comment_id text REFERENCES artifact_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS excerpt text;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_excerpt_length;
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_excerpt_length CHECK (char_length(excerpt) <= 200);

ALTER TABLE notifications ALTER COLUMN title DROP NOT NULL;

-- Every row written before this file has a title; no fact row does.
DELETE FROM notifications WHERE title IS NOT NULL;

-- Serve the SET NULL cascades: deleting a comment, account or team must not
-- scan every notification.
CREATE INDEX IF NOT EXISTS idx_notifications_actor
  ON notifications (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_org
  ON notifications (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_comment
  ON notifications (comment_id) WHERE comment_id IS NOT NULL;
