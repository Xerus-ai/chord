import { randomUUID } from 'node:crypto';
import { NeonDbError } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { db } from './db/client.js';

/**
 * artifact_versions row bookkeeping shared by both version formats: Yjs
 * snapshots of a document artifact (hocuspocus.ts saveVersionSnapshot) and
 * source-text versions of a page artifact (routes/versions.ts). One insert
 * path means one version_number rule — the 0003 unique constraint plus the
 * retry below — for every format.
 */

export type VersionTrigger = 'auto' | 'manual' | 'agent_milestone';

const UNIQUE_VIOLATION = '23505';
const CLIENT_VERSION_INDEX = 'uq_artifact_versions_client_version';
const MAX_VERSION_INSERT_ATTEMPTS = 5;

/**
 * Views and file bytes are kept for this many of an artifact's newest versions
 * (P6 §9 decision 5, §10 decision 5).
 */
const VIEW_RETENTION_VERSIONS = 10;

/**
 * What a version save did: stored the row; found the row an earlier upload
 * with the same client_version_id stored (a sync_queue retry); or refused it
 * because the save was made on top of `base_version` and a newer version has
 * landed since (plan 2026-09-23 P4 step 3 — the desktop's
 * save-artifact-version.ts applies the same rule to its local store).
 */
export type VersionInsertResult =
  | { status: 'saved'; versionId: string }
  | { status: 'existing'; versionId: string }
  | { status: 'conflict'; latestVersion: number };

/**
 * What is stored beside the row: a page version's self-contained view, a
 * document version's Yjs snapshot, or a file version's bytes (base64) with the
 * view an image or docx is shown through (§10).
 */
export type VersionAttachment =
  | { kind: 'view'; html: string }
  | { kind: 'snapshot'; update: Uint8Array }
  | {
      kind: 'file';
      mimeType: string;
      contentBase64: string;
      byteSize: number;
      viewHtml: string | null;
    };

/**
 * Assigns version_number atomically via a single INSERT...SELECT that
 * computes MAX(version_number)+1 in the same statement, backstopped by the
 * uq_artifact_versions_artifact_version unique constraint. Two concurrent
 * snapshots (e.g. an auto-save racing a manual save) can still both read the
 * same MAX under READ COMMITTED — the loser's INSERT then hits the unique
 * constraint instead of silently duplicating a version_number, and is
 * retried against the now-updated MAX.
 *
 * The row, its attachment and (for a view) the view retention sweep run as
 * one db.batch — neon-http's non-interactive transaction — so a version never
 * exists without its view or snapshot. The attachment insert selects the row
 * by id, so a save refused by the base_version check stores nothing at all.
 */
export async function insertVersionRow(row: {
  id: string;
  artifactId: string;
  documentName: string;
  authorId: string | null;
  authorName: string | null;
  label: string | null;
  byteSize: number;
  trigger: VersionTrigger;
  /** Page source for a render_class = 'page' version; null for documents and files. */
  content: string | null;
  /**
   * The version the save was made on (0 for none yet). Checked in the same
   * statement as the insert: HAVING admits the row only while MAX still
   * equals it. null appends unconditionally (automatic snapshots).
   */
  baseVersion: number | null;
  /** The uploading client's id for this version; null for server-made versions. */
  clientVersionId: string | null;
  attachment: VersionAttachment;
}): Promise<VersionInsertResult> {
  // Checked before the base_version rule: a retry of an upload that landed is
  // on a base that is stale only because of that very upload.
  const uploaded = await selectUploadedVersionId(row.artifactId, row.clientVersionId);
  if (uploaded) return { status: 'existing', versionId: uploaded };

  for (let attempt = 1; attempt <= MAX_VERSION_INSERT_ATTEMPTS; attempt++) {
    try {
      const [inserted] = await db.batch([
        db.execute<{ version_number: number }>(sql`
          INSERT INTO artifact_versions
            (id, artifact_id, document_name, version_number, author_id, author_name, label,
             byte_size, trigger, content, client_version_id)
          SELECT ${row.id}, ${row.artifactId}, ${row.documentName},
            COALESCE(MAX(version_number), 0) + 1, ${row.authorId}, ${row.authorName}, ${row.label},
            ${row.byteSize}, ${row.trigger}, ${row.content}, ${row.clientVersionId}
          FROM artifact_versions
          WHERE artifact_id = ${row.artifactId}
          HAVING ${row.baseVersion}::integer IS NULL
            OR COALESCE(MAX(version_number), 0) = ${row.baseVersion}::integer
          RETURNING version_number
        `),
        ...attachmentStatements(row.id, row.artifactId, row.attachment),
      ]);
      if (inserted.rows.length > 0) return { status: 'saved', versionId: row.id };
      return { status: 'conflict', latestVersion: await selectLatestVersionNumber(row.artifactId) };
    } catch (err) {
      if (!(err instanceof NeonDbError) || err.code !== UNIQUE_VIOLATION) throw err;
      if (err.constraint === CLIENT_VERSION_INDEX) {
        // A concurrent retry of the same upload won the race.
        const winner = await selectUploadedVersionId(row.artifactId, row.clientVersionId);
        if (!winner) throw err;
        return { status: 'existing', versionId: winner };
      }
      if (attempt === MAX_VERSION_INSERT_ATTEMPTS) throw err;
    }
  }
  throw new Error(`Version insert for artifact ${row.artifactId} exhausted its attempts`);
}

function viewStatements(versionId: string, artifactId: string, html: string) {
  return [
    db.execute(sql`
      INSERT INTO artifact_version_views (version_id, html, byte_size)
      SELECT id, ${html}, ${Buffer.byteLength(html, 'utf8')}
      FROM artifact_versions WHERE id = ${versionId}
    `),
    // Older versions keep their source; only their view goes.
    db.execute(sql`
      DELETE FROM artifact_version_views
      WHERE version_id IN (
        SELECT id FROM artifact_versions
        WHERE artifact_id = ${artifactId}
        ORDER BY version_number DESC
        OFFSET ${VIEW_RETENTION_VERSIONS}
      )
    `),
  ];
}

function attachmentStatements(
  versionId: string,
  artifactId: string,
  attachment: VersionAttachment
) {
  if (attachment.kind === 'snapshot') {
    const snapshot = Buffer.from(attachment.update).toString('base64');
    return [
      db.execute(sql`
        INSERT INTO artifact_version_snapshots (version_id, snapshot)
        SELECT id, ${snapshot} FROM artifact_versions WHERE id = ${versionId}
      `),
    ];
  }
  if (attachment.kind === 'view') return viewStatements(versionId, artifactId, attachment.html);
  return [
    db.execute(sql`
      INSERT INTO artifact_version_files (version_id, mime_type, byte_size, content_base64)
      SELECT id, ${attachment.mimeType}, ${attachment.byteSize}, ${attachment.contentBase64}
      FROM artifact_versions WHERE id = ${versionId}
    `),
    // Older versions keep their row; only their bytes go.
    db.execute(sql`
      DELETE FROM artifact_version_files
      WHERE version_id IN (
        SELECT id FROM artifact_versions
        WHERE artifact_id = ${artifactId}
        ORDER BY version_number DESC
        OFFSET ${VIEW_RETENTION_VERSIONS}
      )
    `),
    ...(attachment.viewHtml === null
      ? []
      : viewStatements(versionId, artifactId, attachment.viewHtml)),
  ];
}

async function selectUploadedVersionId(
  artifactId: string,
  clientVersionId: string | null
): Promise<string | null> {
  if (clientVersionId === null) return null;
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM artifact_versions
    WHERE artifact_id = ${artifactId} AND client_version_id = ${clientVersionId}
  `);
  return result.rows[0]?.id ?? null;
}

async function selectLatestVersionNumber(artifactId: string): Promise<number> {
  const result = await db.execute<{ latest: number }>(sql`
    SELECT COALESCE(MAX(version_number), 0)::integer AS latest
    FROM artifact_versions
    WHERE artifact_id = ${artifactId}
  `);
  return Number(result.rows[0]!.latest);
}

const AUTO_VERSION_RETENTION_RECENT_HOURS = 24;
const AUTO_VERSION_RETENTION_MAX_TOTAL = 50;

/**
 * MAINT-1: auto-versioning every AUTO_SAVE_INTERVAL-th store (~36/hr under
 * continuous editing) accumulates artifact_versions rows and their Postgres
 * snapshot blobs forever with no pruning. This is housekeeping for
 * trigger='auto' rows ONLY — manual and agent_milestone snapshots are never
 * touched here; deleting one of those needs a deliberate product decision,
 * not an automatic sweep.
 *
 * Policy, applied as two passes in one statement:
 *  1. Daily thinning — every auto version younger than
 *     AUTO_VERSION_RETENTION_RECENT_HOURS is kept unconditionally; every
 *     older one is thinned to the single newest version per calendar day
 *     (rest deleted).
 *  2. Hard cap — of whatever survives pass 1, keep only the
 *     AUTO_VERSION_RETENTION_MAX_TOTAL most recent by version_number, oldest
 *     excess deleted. This is an absolute ceiling: if an artifact somehow
 *     accumulates more than the cap within the "recent" window itself
 *     (sustained heavy editing), the cap still wins over "keep every recent
 *     version" — 50 rows of 100s-of-KB blobs each is the ceiling we're
 *     willing to hold per artifact, full stop.
 *
 * Deleting an artifact_versions row cascades to its artifact_version_snapshots
 * row (ON DELETE CASCADE — see schema.ts), so the blob is reclaimed in the
 * same statement; snapshot rows can never orphan or outlive their version
 * row as a result.
 *
 * No new index: the existing uq_artifact_versions_artifact_version unique
 * index leads with artifact_id, so the WHERE artifact_id = ... scan is
 * already an index range scan; trigger = 'auto' then filters within that
 * small per-artifact row set (bounded by this very policy to roughly
 * recent-24h-count + the cap), which doesn't warrant a second index at this
 * scale.
 */
async function pruneAutoVersions(artifactId: string): Promise<void> {
  await db.execute(sql`
    WITH daily_ranked AS (
      SELECT
        id,
        version_number,
        (
          created_at >= now() - ${AUTO_VERSION_RETENTION_RECENT_HOURS} * interval '1 hour'
          OR ROW_NUMBER() OVER (
            PARTITION BY created_at::date ORDER BY version_number DESC
          ) = 1
        ) AS keep_in_daily_pass
      FROM artifact_versions
      WHERE artifact_id = ${artifactId} AND trigger = 'auto'
    ),
    survivors AS (
      SELECT id, version_number FROM daily_ranked WHERE keep_in_daily_pass
    ),
    capped AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY version_number DESC) AS recency_rank
      FROM survivors
    )
    DELETE FROM artifact_versions
    WHERE id IN (
      SELECT id FROM daily_ranked WHERE NOT keep_in_daily_pass
      UNION
      SELECT id FROM capped WHERE recency_rank > ${AUTO_VERSION_RETENTION_MAX_TOTAL}
    )
  `);
}

/**
 * Detached — deliberately NOT awaited by callers. The version that triggered
 * this is already durably saved; pruning is bounded background cleanup, not
 * part of the save's correctness contract, and the document path runs inside
 * Hocuspocus's own debounced onStoreDocument hook — making every 10th store
 * wait on a housekeeping DELETE would slow down the actual save path (and
 * everyone waiting on that debounce). A failed prune must still be visible —
 * logged loudly, never silently swallowed — but must never fail or delay the
 * save that triggered it. Manual saves never call this.
 */
export function scheduleAutoVersionPrune(artifactId: string, documentName: string): void {
  pruneAutoVersions(artifactId).catch((err) => {
    console.error(`[hocuspocus] auto-version retention prune failed for ${documentName}:`, err);
  });
}

/**
 * Versions a page artifact (render_class 'page'). A page has no Yjs room, so
 * the version is the page source itself, stored on the row; byte_size is its
 * UTF-8 length. The view the author's app built from that source is stored
 * beside it. document_name keeps the artifact-<id> key every version row
 * carries. Pruning only ever applies to 'auto' versions.
 */
export async function savePageSourceVersion(version: {
  artifactId: string;
  source: string;
  viewHtml: string;
  authorId: string | null;
  authorName: string | null;
  label: string | null;
  trigger: VersionTrigger;
  baseVersion: number | null;
  clientVersionId: string | null;
}): Promise<VersionInsertResult> {
  const documentName = `artifact-${version.artifactId}`;
  const result = await insertVersionRow({
    id: randomUUID(),
    artifactId: version.artifactId,
    documentName,
    authorId: version.authorId,
    authorName: version.authorName,
    label: version.label,
    byteSize: Buffer.byteLength(version.source, 'utf8'),
    trigger: version.trigger,
    content: version.source,
    baseVersion: version.baseVersion,
    clientVersionId: version.clientVersionId,
    attachment: { kind: 'view', html: version.viewHtml },
  });
  if (result.status === 'saved' && version.trigger === 'auto') {
    scheduleAutoVersionPrune(version.artifactId, documentName);
  }
  return result;
}

/**
 * Versions a file artifact (render_class 'file', §10): the bytes and MIME type
 * go beside the row, with the view for an image or docx. byte_size is the raw
 * file size. Files are only ever versioned by an upload, never automatically.
 */
export async function saveFileVersion(version: {
  artifactId: string;
  mimeType: string;
  contentBase64: string;
  byteSize: number;
  viewHtml: string | null;
  authorId: string | null;
  authorName: string | null;
  label: string | null;
  trigger: VersionTrigger;
  baseVersion: number | null;
  clientVersionId: string | null;
}): Promise<VersionInsertResult> {
  return insertVersionRow({
    id: randomUUID(),
    artifactId: version.artifactId,
    documentName: `artifact-${version.artifactId}`,
    authorId: version.authorId,
    authorName: version.authorName,
    label: version.label,
    byteSize: version.byteSize,
    trigger: version.trigger,
    content: null,
    baseVersion: version.baseVersion,
    clientVersionId: version.clientVersionId,
    attachment: {
      kind: 'file',
      mimeType: version.mimeType,
      contentBase64: version.contentBase64,
      byteSize: version.byteSize,
      viewHtml: version.viewHtml,
    },
  });
}
