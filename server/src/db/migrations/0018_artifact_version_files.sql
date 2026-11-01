-- Artifact version files (artifact publishing plan, P6 — binary files).
--
-- `.pdf/.docx/.pptx` and images had no viewer: they fell into the document
-- editor as garbled text. They become render class 'file', versioned as their
-- bytes: design docs/plans/2026-09-24-p6-sharing-design.md §10.
--
--   artifact_version_files     one file per version, deleted with it: the
--                              bytes as base64 text and the MIME type that
--                              decides the viewer. Kept for the newest 10
--                              versions of an artifact.
--   documents and images       move to render class 'file'. Their Yjs rooms
--                              only ever held the file misread as text; the
--                              sync server now refuses every class but
--                              'document'.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

CREATE TABLE IF NOT EXISTS artifact_version_files (
  version_id text PRIMARY KEY REFERENCES artifact_versions(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  content_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

UPDATE artifacts
SET render_class = 'file'
WHERE content_type IN ('document', 'image') AND render_class <> 'file';
