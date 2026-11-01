-- Artifact comment reads (shared-items step 1, S8).
--
-- When each account last read an artifact's comments. The rail's unread dot
-- is "another person commented after this" (step 1 plan §4 question 2:
-- unread is kept per account in the cloud, so the teammate view of step 4
-- reads the same record).
--
--   artifact_comment_reads   one row per account and artifact, moved forward
--                            by PUT .../comments/read; deleted with either.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

CREATE TABLE IF NOT EXISTS artifact_comment_reads (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id text NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artifact_id)
);

-- The summary joins reads by artifact for one caller; the primary key's
-- leading user_id serves that lookup, and this serves the cascade from
-- artifacts.
CREATE INDEX IF NOT EXISTS idx_artifact_comment_reads_artifact
  ON artifact_comment_reads (artifact_id);
