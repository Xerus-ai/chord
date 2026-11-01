-- 0003_artifact_versions_unique.sql
--
-- COR-3 (artifact_versions TOCTOU / duplicate version_number).
--
-- saveVersionSnapshot previously read MAX(version_number) then INSERTed in
-- two separate statements with no transaction and no constraint — two
-- concurrent snapshots (auto-save from onStoreDocument racing a manual
-- POST /versions) could both read the same max and insert the same
-- version_number for the same artifact. The app fix (hocuspocus.ts) makes
-- the insert a single atomic INSERT...SELECT with retry-on-conflict; this
-- migration adds the DB-level constraint that fix relies on, and first
-- repairs any duplicates the race has already produced.
--
-- Dedupe strategy: RENUMBER, never DELETE. Deleting a duplicate row would
-- also orphan its on-disk .yjs snapshot file (versionPath) and destroy a
-- real, non-corrupt version snapshot a collaborator may have already viewed
-- — data loss the repo's no-fallback/no-silent-loss rule forbids. Instead,
-- for every (artifact_id, version_number) group with more than one row, the
-- lowest-id row keeps its version_number (arbitrary but deterministic
-- tie-break — id is a random UUID with no chronological meaning, but ties
-- must be broken somehow and consistently); every other row in the group is
-- renumbered to a new version_number appended after that artifact's current
-- max, so every row and its snapshot file remains valid and listed, just
-- reordered relative to true creation time for the renumbered rows only.
-- Idempotent: after one run no duplicates remain, so a re-run's
-- dup_rank > 1 filter matches nothing and the UPDATE affects 0 rows.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0003_artifact_versions_unique.sql
--
-- Before applying, sanity-check how many duplicates exist (informational
-- only — the migration below handles them regardless of the count):
--
--   SELECT artifact_id, version_number, count(*)
--   FROM artifact_versions
--   GROUP BY artifact_id, version_number
--   HAVING count(*) > 1;
--
-- idx_artifact_versions_artifact was created in 0000_cooing_fat_cobra.sql on
-- the same leading columns (artifact_id, version_number) as the unique
-- constraint added below, which is backed by its own index — the plain
-- index is dropped so there isn't a redundant duplicate.

-- ─── Renumber duplicates (keep lowest id, push the rest past current max) ──

WITH duplicate_ranks AS (
  SELECT
    id,
    artifact_id,
    ROW_NUMBER() OVER (
      PARTITION BY artifact_id, version_number ORDER BY id
    ) AS dup_rank
  FROM artifact_versions
),
artifact_max AS (
  SELECT artifact_id, MAX(version_number) AS max_version
  FROM artifact_versions
  GROUP BY artifact_id
),
renumbered AS (
  SELECT
    dr.id,
    am.max_version + ROW_NUMBER() OVER (
      PARTITION BY dr.artifact_id ORDER BY dr.id
    ) AS new_version_number
  FROM duplicate_ranks dr
  JOIN artifact_max am ON am.artifact_id = dr.artifact_id
  WHERE dr.dup_rank > 1
)
UPDATE artifact_versions av
SET version_number = r.new_version_number
FROM renumbered r
WHERE av.id = r.id;

-- ─── Constraint ──────────────────────────────────────────────────────────

DROP INDEX idx_artifact_versions_artifact;

ALTER TABLE artifact_versions
  ADD CONSTRAINT uq_artifact_versions_artifact_version
    UNIQUE (artifact_id, version_number);
