-- Artifact version views (artifact publishing plan, P6 — viewing model).
--
-- A teammate on another device, and a public link, see a page artifact through
-- a self-contained HTML "view" the author's app builds and uploads with each
-- version: design docs/plans/2026-09-24-p6-sharing-design.md §9.
--
--   artifact_version_views     one view per version, deleted with it. Views
--                              are kept for the newest 10 versions of an
--                              artifact; older versions keep their source.
--   artifact_versions.client_version_id
--                              the desktop's id for an uploaded version: its
--                              sync_queue retries the upload, and a repeat of
--                              the same id answers with the stored row
--                              instead of adding a second version.
--   mdx artifacts              move to render class 'page' (decision 2): their
--                              Yjs document only ever held one
--                              <mdx-component> tag, so no prose is lost.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

CREATE TABLE IF NOT EXISTS artifact_version_views (
  version_id text PRIMARY KEY REFERENCES artifact_versions(id) ON DELETE CASCADE,
  html text NOT NULL,
  byte_size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS client_version_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_versions_client_version
  ON artifact_versions (artifact_id, client_version_id)
  WHERE client_version_id IS NOT NULL;

UPDATE artifacts
SET render_class = 'page'
WHERE content_type = 'mdx' AND render_class <> 'page';
