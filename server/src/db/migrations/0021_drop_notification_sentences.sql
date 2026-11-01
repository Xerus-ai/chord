-- Drop notification sentences (shared-items step 2, N2).
--
-- 0020 made title/body optional and gave every notification its facts; since
-- N2 no producer writes a sentence and no client reads one (the app builds it
-- from the facts), so the columns go.
--
-- The daily retention delete (read rows older than 30 days,
-- notifications/delete-expired-notifications.ts) reads by age across every
-- user; idx_notifications_user leads with user_id, so it gets its own partial
-- index.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE notifications
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS body;

CREATE INDEX IF NOT EXISTS idx_notifications_read_created
  ON notifications (created_at) WHERE read = true;
