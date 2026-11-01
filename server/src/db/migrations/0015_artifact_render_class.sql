-- Artifact render class (artifact publishing plan, P1a step 8).
--
-- Users see five artifact formats; the engine has two render paths. A
-- 'document' (.md, .mdx, and the view-only .pdf/.docx/.pptx/.txt types) is
-- co-edited through a Hocuspocus/Yjs room named artifact-<id>. A 'page' (.html
-- web pages, .tsx interactive prototypes) is an opaque sandboxed frame and
-- must NEVER get a Yjs room: hocuspocus.ts resolveDocumentAccess refuses the
-- connection and POST /agent-edits refuses the edit. An 'image' is a plain
-- bitmap. The client computes the class (src/shared/artifact-render-class.ts)
-- and sends it on artifact registration.
--
-- Versioning becomes format-aware. A document version still snapshots its Yjs
-- state into artifact_version_snapshots; a page has no Yjs state, so its
-- version stores the page source in artifact_versions.content (NULL for
-- documents). The (artifact_id, version_number) unique constraint from 0003
-- applies to both unchanged.
--
-- Backfill: rows registered before this column existed defaulted to
-- 'document'. Every content_type the client maps to a page ('web',
-- 'prototype') is corrected to 'page'. Idempotent on re-run.
--
-- IF NOT EXISTS-guarded like 0009/0010/0012/0013: a database that already
-- received part of this file (crashed deploy, manual poke) can re-run it to
-- completion.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or
-- `pnpm run migrate`, which wraps each file in BEGIN/COMMIT).

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS render_class text NOT NULL DEFAULT 'document';

UPDATE artifacts
SET render_class = 'page'
WHERE content_type IN ('web', 'prototype') AND render_class <> 'page';

ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS content text;
