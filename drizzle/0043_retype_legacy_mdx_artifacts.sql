-- Rows created before `mdx` was a content type carry `markdown` with an `.mdx`
-- path. MDX is a page now (P6 design 2026-09-24 §9 decision 2), so they are
-- retyped. Clearing `synced_at` puts each one back in the set the startup
-- reconcile registers with the cloud (sync-queue-service
-- reconcileLocalArtifacts): the server's artifact create is an upsert that
-- rewrites content_type and render_class, and the successful send stamps
-- `synced_at` again, so the row is re-registered exactly once.
UPDATE `artifacts`
SET `type` = 'mdx', `content_type` = 'mdx', `synced_at` = NULL
WHERE `type` = 'markdown' AND lower(`file_path`) LIKE '%.mdx';
