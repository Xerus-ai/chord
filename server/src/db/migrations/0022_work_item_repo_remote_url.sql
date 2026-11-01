-- Work item repo remote (shared-items step 3, H7).
--
-- The repo a work item lives in, as its normalized origin
-- (`github.com/acme/chord`: normalizeRemoteUrl in the desktop's
-- src/shared/repo-remote-url.ts). A teammate's sidebar matches it against its
-- own repos' origins, so a shared item joins their group for the same repo;
-- repo_name is only the owner's local alias and never matches.
--
-- Nullable and additive: older desktop builds send none, and the owner's app
-- backfills existing items through the startup reconcile's PATCH.
--
-- Guarded so a partially applied file can re-run. Apply TRANSACTIONALLY
-- (`pnpm run migrate` wraps each file in BEGIN/COMMIT).

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS repo_remote_url text;
