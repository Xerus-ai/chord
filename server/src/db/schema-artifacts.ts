import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users, workItems } from './schema.js';

/**
 * Artifacts: comments and their reads, versions with their views, files and
 * Yjs snapshots, and the live Yjs documents.
 *
 * One of the server schema modules (schema*.ts): db/client.ts merges them,
 * and drizzle-kit reads them all.
 */

// ─── Artifacts ───────────────────────────────────────────────────────────────

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    work_item_id: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content_type: text('content_type').notNull().default('markdown'),
    // 'document' | 'page' | 'file'. A 'page' (web page, interactive
    // prototype, mdx) never gets a Yjs room and versions its source text; a
    // 'file' (pdf, docx, pptx, image) versions its bytes (P6 §10).
    render_class: text('render_class').notNull().default('document'),
    // General access (P6): 'invited' | 'team' | 'link'. It only ever ADDS to
    // what the work item grants — see access/resolve-access.ts. 'link' is
    // view-only and served through share_links.
    general_access: text('general_access').notNull().default('invited'),
    general_role: text('general_role').notNull().default('view'),
    content: text('content').notNull().default(''),
    // The owner's status: 'draft' | 'in_review' | 'approved' | 'built'
    // (ck_artifacts_status, 0024), sent with every register; null until the
    // owner's app has sent one.
    status: text('status'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_artifacts_work_item').on(table.work_item_id),
    // Target of the (artifact_id, work_item_id) foreign keys on
    // resource_members and share_links.
    unique('uq_artifacts_id_work_item').on(table.id, table.work_item_id),
  ]
);

// ─── Artifact Comments ───────────────────────────────────────────────────────

export const artifactComments = pgTable(
  'artifact_comments',
  {
    id: text('id').primaryKey(),
    artifact_id: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    parent_comment_id: text('parent_comment_id'),
    author_id: text('author_id')
      .notNull()
      .references(() => users.id),
    author_name: text('author_name').notNull(),
    anchor_key: text('anchor_key'),
    anchor_text: text('anchor_text'),
    body: text('body').notNull(),
    resolved: boolean('resolved').default(false),
    resolved_by: text('resolved_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_comments_artifact').on(table.artifact_id, table.created_at)]
);

// ─── Artifact Comment Reads (shared-items S8, 0019) ─────────────────────────

// When an account last read an artifact's comments: the rail's unread dot is
// another person's comment newer than this (routes/artifact-summary.ts).
export const artifactCommentReads = pgTable(
  'artifact_comment_reads',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    artifact_id: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    last_read_at: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.artifact_id] }),
    index('idx_artifact_comment_reads_artifact').on(table.artifact_id),
  ]
);

// ─── Artifact Versions ──────────────────────────────────────────────────────

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    artifact_id: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    document_name: text('document_name').notNull(),
    version_number: integer('version_number').notNull(),
    author_id: text('author_id').references(() => users.id),
    author_name: text('author_name'),
    label: text('label'),
    byte_size: integer('byte_size').notNull().default(0),
    trigger: text('trigger').notNull().default('auto'),
    // Page source text for a render_class = 'page' artifact's version; NULL
    // for documents, whose content is the Yjs snapshot in
    // artifact_version_snapshots. List reads must exclude this column.
    content: text('content'),
    // The desktop's id for a version it uploaded (P6 §9): a sync_queue retry
    // of the same upload answers with this row instead of adding a version.
    // NULL for versions the server made itself (auto, public link, agent-edits).
    client_version_id: text('client_version_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Also serves as the lookup/ordering index for GET /versions (queries
    // filter by artifact_id and ORDER BY version_number DESC) — a separate
    // plain index on the same columns would be redundant.
    unique('uq_artifact_versions_artifact_version').on(table.artifact_id, table.version_number),
    uniqueIndex('uq_artifact_versions_client_version')
      .on(table.artifact_id, table.client_version_id)
      .where(sql`${table.client_version_id} is not null`),
  ]
);

// ─── Artifact Version Views (P6 viewing model, 0017) ────────────────────────

// The self-contained HTML the author's app builds for a page version — how a
// teammate on another device and a public link see the page. Sibling table
// for the same reason as artifact_version_snapshots: a view can be megabytes
// (capped at 8 MiB) and list reads must never pull it. Kept for the newest 10
// versions of an artifact (artifact-version-rows.ts); older versions keep
// their source in artifact_versions.content.
export const artifactVersionViews = pgTable('artifact_version_views', {
  version_id: text('version_id')
    .primaryKey()
    .references(() => artifactVersions.id, { onDelete: 'cascade' }),
  html: text('html').notNull(),
  byte_size: integer('byte_size').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Artifact Version Files (P6 binary files, 0018) ─────────────────────────

// A file artifact's version (pdf, docx, pptx, image — render_class 'file'):
// the file's bytes as base64 text (same bytea-vs-base64 tradeoff as
// yjsDocuments.state) and its MIME type, which decides the viewer. Sibling
// table like artifact_version_views: up to 8 MiB of raw bytes that list reads
// must never pull. Kept for the newest 10 versions (artifact-version-rows.ts).
export const artifactVersionFiles = pgTable('artifact_version_files', {
  version_id: text('version_id')
    .primaryKey()
    .references(() => artifactVersions.id, { onDelete: 'cascade' }),
  mime_type: text('mime_type').notNull(),
  byte_size: integer('byte_size').notNull(),
  content_base64: text('content_base64').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Artifact Version Snapshots (full Yjs state, sibling of artifact_versions) ──

// Split from artifact_versions itself rather than a nullable column on that
// table: GET /:artifact_id/versions lists every version via a plain
// `SELECT *` and must stay cheap — snapshots are potentially 100s of KB each
// (base64-encoded full Yjs state, same bytea-vs-base64 tradeoff documented on
// yjsDocuments.state below), so keeping them on the same row would make every
// list call pull megabytes of blob data nobody asked for. Mirrors the
// workItemGitState/workItemGitFiles split above: metadata table stays lean,
// content is fetched one row at a time by PK only when a specific version's
// snapshot is actually requested.
export const artifactVersionSnapshots = pgTable('artifact_version_snapshots', {
  version_id: text('version_id')
    .primaryKey()
    .references(() => artifactVersions.id, { onDelete: 'cascade' }),
  snapshot: text('snapshot').notNull(),
});

// ─── Yjs Document Persistence ───────────────────────────────────────────────

// ARCH-3a: replaces server/data/hocuspocus/*.yjs local-disk persistence. A
// restart on any deploy without a mounted volume previously deleted every
// live collaborative document — data loss, not degraded UX — and pinned the
// server to one node. document_name is the Hocuspocus room key
// (artifact-<artifact_id>).
//
// state is base64-encoded Y.encodeStateAsUpdate() bytes, not a native bytea
// column: drizzle-orm 0.39's pg-core ships no bytea() helper, and
// hand-rolling a customType() bytea mapping against neon-http's HTTP/JSON
// transport can't be verified without a live DB to round-trip against —
// getting it wrong here means silent corruption, exactly what this table
// exists to prevent. Base64 costs ~33% more storage and a JS-side
// encode/decode per read/write, but reuses the same text-column path every
// other column in this schema already goes through; Postgres TOASTs large
// TEXT the same way it TOASTs large bytea, so it scales the same either way.
//
// No state_vector column: nothing in this codebase computes incremental
// diffs server-side — Hocuspocus already handles delta sync between live
// clients over the WS protocol, and this table only ever needs the full
// state for onLoadDocument/onStoreDocument. Add it if a future feature
// actually needs it.
export const yjsDocuments = pgTable('yjs_documents', {
  document_name: text('document_name').primaryKey(),
  state: text('state').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
