-- 0006_yjs_postgres_persistence.sql
--
-- ARCH-3a (durability half of #14 — Yjs persistence off local disk).
--
-- Live Yjs documents (server/data/hocuspocus/*.yjs) and version snapshots
-- (versionPath) persisted only to local disk. A restart on any deploy
-- without a mounted volume deleted every collaborative document and every
-- version snapshot outright — user data loss, not degraded UX — and pinned
-- the server to a single node. This migration adds the two tables the
-- application fix (server/src/hocuspocus.ts) now reads/writes instead of the
-- filesystem.
--
-- yjs_documents: one row per Hocuspocus document (document_name = the room
-- key, e.g. artifact-<id>), storing the full Y.encodeStateAsUpdate() output.
--
-- artifact_version_snapshots: split from artifact_versions itself rather
-- than a column on that table — GET /:artifact_id/versions lists every
-- version via a plain SELECT * and must stay cheap; snapshots can be 100s of
-- KB each, so keeping them on the same row would make every list call pull
-- megabytes of blob data nobody asked for. This mirrors the existing
-- work_item_git_state / work_item_git_files split (0001_participant_view.sql)
-- — metadata table stays lean, content is fetched one row at a time by PK.
--
-- Both tables store base64-encoded bytes in a text column, not a native
-- bytea column: drizzle-orm 0.39's pg-core ships no bytea() helper, and
-- hand-rolling a customType() bytea mapping against neon-http's HTTP/JSON
-- transport couldn't be verified without a live DB round trip — wrong here
-- means silent corruption, exactly what these tables exist to prevent.
-- Base64 costs ~33% more storage and a JS-side encode/decode per read/write,
-- but reuses the same text-column path every other column in this schema
-- already goes through, and Postgres TOASTs large TEXT the same way it
-- TOASTs large bytea, so it scales the same either way. See schema.ts for
-- the full rationale (kept there, not duplicated further here).
--
-- Migrating existing disk data: this SQL migration only creates the tables —
-- it cannot read the filesystem the way a code-level migration script could,
-- and there is no live-DB access from this session to run one anyway. The
-- actual data migration is a LAZY IMPORT implemented in
-- server/src/hocuspocus.ts (readDocumentState / readVersionSnapshot): on a
-- cache miss (DB row absent), each function reads the legacy on-disk file if
-- one exists, validates it with the same Yjs corruption probe used
-- everywhere else in this file, upserts it into the new table, and returns
-- the bytes to the caller — all before this table has ever been queried by
-- anything else. The on-disk file is left in place afterward, never
-- deleted, so it still serves as a backup even after the DB row exists. This
-- import is idempotent: the upsert is keyed on document_name /
-- version_id, so if two server nodes both cold-load the same
-- never-before-imported document simultaneously (the exact scenario this
-- migration is meant to unblock — multiple nodes, no shared disk), both
-- import attempts write the same row and neither corrupts the other; no
-- locking is required. No explicit backfill step runs here — every existing
-- document and version snapshot gets imported the first time something
-- reads it after this migration is applied and the app is deployed with the
-- new code.
--
-- Apply TRANSACTIONALLY over a real session (psql, Neon SQL editor, or MCP
-- run_sql_transaction) — never through the app's neon-http driver, where
-- each statement is its own implicit transaction:
--
--   psql "$DATABASE_URL" --single-transaction -f 0006_yjs_postgres_persistence.sql
--
-- Mirrors drizzle/0004_curly_nekra.sql (drizzle-kit generate output, kept in
-- place for drizzle-kit's snapshot chain); this file is the applied set.

CREATE TABLE yjs_documents (
  document_name text PRIMARY KEY,
  state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifact_version_snapshots (
  version_id text PRIMARY KEY REFERENCES artifact_versions(id) ON DELETE CASCADE,
  snapshot text NOT NULL
);
