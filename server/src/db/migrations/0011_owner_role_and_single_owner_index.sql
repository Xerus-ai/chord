-- Owner role + single-owner invariant on org_memberships.
--
-- Two changes, one deploy step, ordered — the backfill MUST run before the
-- index. The index enforces at-most-one `owner` per org, so any org that still
-- had two `owner`/`admin` rows would make CREATE UNIQUE INDEX fail. Running
-- them in this order inside one transaction (migrate.ts wraps each file in
-- BEGIN/COMMIT) means the data is already single-owner by the time the index is
-- built.
--
--   1. Backfill roles to the two-role model (`owner` + `member`). Drop `admin`.
--      Exactly one owner per org: prefer the existing owner/admin (the creator,
--      inserted as `admin` by the create path), tie-broken by user_id so the
--      choice is deterministic and every org ends with precisely one owner.
--      `org_memberships` carries no created_at, so user_id is the only stable
--      ordering available — the admin-first ranking makes it moot in the common
--      single-admin org anyway.
--
--   2. Partial unique index so "at most one owner per org" can never drift.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or the
-- migrate runner) — never the app's neon-http driver, where each statement is
-- its own implicit transaction and the ordering guarantee above is lost:
--
--   psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f 0011_owner_role_and_single_owner_index.sql

WITH ranked AS (
  SELECT
    user_id,
    org_id,
    ROW_NUMBER() OVER (
      PARTITION BY org_id
      ORDER BY (CASE WHEN role IN ('owner', 'admin') THEN 0 ELSE 1 END), user_id
    ) AS rank
  FROM org_memberships
)
UPDATE org_memberships AS m
SET role = CASE WHEN r.rank = 1 THEN 'owner' ELSE 'member' END
FROM ranked AS r
WHERE m.user_id = r.user_id
  AND m.org_id = r.org_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_single_owner
  ON org_memberships (org_id)
  WHERE role = 'owner';
