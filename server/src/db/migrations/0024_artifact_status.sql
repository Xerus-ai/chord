-- An artifact's status is the owner's (devstation-664).
--
-- The owner's app has four: draft, in_review, approved, built. It now sends
-- the status when it registers an artifact, and re-registers on every change,
-- so a teammate's file bar shows what the owner's does. Until the owner's app
-- sends one, an artifact has none.
--
-- The old default 'in_progress' was never sent by any app and is none of the
-- four, and older databases hold other words no current code writes (the dev
-- database had 'active'): every value that is not one of the four is cleared,
-- the default is dropped, and the column takes only the four (or none).
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE artifacts ALTER COLUMN status DROP DEFAULT;
UPDATE artifacts SET status = NULL
  WHERE status NOT IN ('draft', 'in_review', 'approved', 'built');
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS ck_artifacts_status;
ALTER TABLE artifacts ADD CONSTRAINT ck_artifacts_status
  CHECK (status IS NULL OR status IN ('draft', 'in_review', 'approved', 'built'));
