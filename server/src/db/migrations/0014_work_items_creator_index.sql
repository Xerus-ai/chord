-- Index on work_items.creator_id.
--
-- Every creator-scoped read filters on this column and none had an index:
-- GET /work-items (the owner's own list), GET /work-items/participants-summary
-- (git-state capture), and GET /work-items/participant-rosters (the
-- dashboard's shared-with avatars, one bulk read instead of one per card).
-- Without it each is a sequential scan of work_items.
--
-- IF NOT EXISTS-guarded like 0009/0010/0012/0013: a database that already
-- received this file can re-run it.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or
-- `pnpm run migrate`, which wraps each file in BEGIN/COMMIT).

CREATE INDEX IF NOT EXISTS idx_work_items_creator ON work_items (creator_id);
