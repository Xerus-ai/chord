import { createHash } from 'node:crypto';
import {
  CloudGitStatePutBodySchema,
  GIT_SNAPSHOT_CONTENT_BYTE_BUDGET,
  utf8ByteLength,
  type GitStateUpdatedServerEvent,
} from '@chord/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { workItemGitFiles, workItemGitState } from '../db/schema.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

interface WorkItemParams {
  work_item_id: string;
}

/**
 * Mirrors src/main/core/work-items/git-state-capture.ts's computeContentHash
 * by convention — a hash function is behavior, not a wire shape, so it does
 * not live in @chord/protocol; keep both in the same commit. Length-prefixed
 * so no original/modified boundary is ambiguous.
 */
function computeContentHash(original: string, modified: string): string {
  return createHash('sha256')
    .update(String(Buffer.byteLength(original, 'utf8')))
    .update('\0')
    .update(original, 'utf8')
    .update('\0')
    .update(String(Buffer.byteLength(modified, 'utf8')))
    .update('\0')
    .update(modified, 'utf8')
    .digest('hex');
}

// The shared body shape plus the server-side backstops. The owner enforces
// both caps at capture; these re-check them because the payload arrives from
// a client. Cross-field rules stay here rather than in @chord/protocol — they
// are validation policy, not part of the shape both sides agree on.
const PutGitStateSchema = CloudGitStatePutBodySchema.refine(
  (body) =>
    body.contents.reduce(
      (total, c) => total + utf8ByteLength(c.original) + utf8ByteLength(c.modified),
      0
    ) <= GIT_SNAPSHOT_CONTENT_BYTE_BUDGET,
  { error: `snapshot contents exceed ${GIT_SNAPSHOT_CONTENT_BYTE_BUDGET} byte budget` }
).refine(
  (body) => {
    const metaByPath = new Map(body.files.map((f) => [f.path, f]));
    return body.contents.every((c) => metaByPath.get(c.path)?.content_omitted === false);
  },
  { error: 'contents may only carry files listed with content_omitted=false' }
);

const FileQuerySchema = z.object({
  path: z.string().min(1),
});

export function createGitStateRouter(connectionManager: ConnectionManager): Router {
  const gitStateRouter = Router({ mergeParams: true });
  gitStateRouter.use(requireWorkItemRole('view'));

  // Metadata only: file list + stats + flags. Contents are fetched lazily,
  // one file at a time, via GET /file.
  gitStateRouter.get('/', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const [row] = await db
      .select()
      .from(workItemGitState)
      .where(eq(workItemGitState.work_item_id, work_item_id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: 'No git state for this work item' });
      return;
    }

    res.json(row);
  });

  gitStateRouter.get('/file', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = FileQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const [file] = await db
      .select()
      .from(workItemGitFiles)
      .where(
        and(
          eq(workItemGitFiles.work_item_id, work_item_id),
          eq(workItemGitFiles.path, parsed.data.path)
        )
      )
      .limit(1);

    if (!file) {
      res.status(404).json({ error: 'No content for this file' });
      return;
    }

    res.json({ path: file.path, original: file.original, modified: file.modified });
  });

  /**
   * Owner snapshot push. Creator-only — participants must never overwrite the
   * shared view of the owner's working tree. ONE atomic upsert: version bumps
   * in-SQL, and the WHERE guard rejects out-of-order captures when two owner
   * windows race (same owner clock). A filtered-out no-op returns 200 and
   * broadcasts nothing. The thin-ping broadcast uses the upsert's RETURNING
   * values — a separate read-back could pair another PUT's newer version with
   * this PUT's older payload, pinning participants on a stale snapshot via
   * the client version guard.
   */
  gitStateRouter.put(
    '/',
    requireWorkItemRole('author'),
    async (req: Request<WorkItemParams>, res) => {
      const { work_item_id } = req.params;
      const parsed = PutGitStateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      // Diff content rows against what actually changed since the last accepted
      // push, instead of delete-all + insert-all: most pushes touch a handful
      // of files out of a much larger diff, and a full replace rewrote every
      // row (and every byte) even when nothing about a file changed. Computed
      // — and fully validated — before the state row is touched below: a
      // rejection here must leave nothing written, including the metadata row.
      const targetPaths = parsed.data.files.filter((f) => !f.content_omitted);

      const existingRows = await db
        .select({ path: workItemGitFiles.path, content_hash: workItemGitFiles.content_hash })
        .from(workItemGitFiles)
        .where(eq(workItemGitFiles.work_item_id, work_item_id));
      const existingHashByPath = new Map(existingRows.map((r) => [r.path, r.content_hash]));

      const targetPathSet = new Set(targetPaths.map((f) => f.path));
      const toDelete = existingRows.map((r) => r.path).filter((path) => !targetPathSet.has(path));

      const contentByPath = new Map(parsed.data.contents.map((c) => [c.path, c]));
      const toUpsert: { path: string; original: string; modified: string; content_hash: string }[] =
        [];
      for (const file of targetPaths) {
        const { path, content_hash: claimedHash } = file;

        // Hash-aware client (content_hash present): honor the "unchanged, skip"
        // claim only when it actually matches what's stored — this is the only
        // case content is allowed to be omitted from the push.
        if (claimedHash !== undefined && existingHashByPath.get(path) === claimedHash) continue;

        const content = contentByPath.get(path);
        if (!content) {
          if (claimedHash === undefined) {
            // Pre-delta-protocol client: every content_omitted=false file must
            // carry content — this is a plain malformed payload, not a
            // reconciliation conflict.
            res.status(400).json({ error: `no content was sent for '${path}'` });
            return;
          }
          // Hash-aware client claimed a change (or a hash we don't have on
          // record) but didn't attach the bytes. The delta can't be applied
          // coherently — fail it explicitly rather than silently keeping a
          // stale/absent row, so the client can detect the conflict and fall
          // back to a full, non-delta push next time (see
          // git-state-capture.ts's reconcileConfirmedHashes: a failed push's
          // assumed hashes are never promoted to "confirmed", so the next
          // capture re-includes full content for anything not already solidly
          // confirmed).
          res.status(409).json({
            error: 'git_state_diverged',
            path,
            detail: 'content_hash changed but no content was sent for it',
          });
          return;
        }

        const actualHash = computeContentHash(content.original, content.modified);
        if (claimedHash !== undefined && actualHash !== claimedHash) {
          res
            .status(409)
            .json({ error: 'git_state_diverged', path, detail: 'content_hash mismatch' });
          return;
        }

        // claimedHash undefined (old client, trusted as-is like before) or
        // freshly verified — either way, store a real hash so later pushes
        // (from any client version) can reconcile against this row.
        toUpsert.push({
          path,
          original: content.original,
          modified: content.modified,
          content_hash: claimedHash ?? actualHash,
        });
      }

      const capturedAt = new Date(parsed.data.captured_at);

      // Build all statements up front and execute them in a single db.batch()
      // — one non-interactive transaction on neon-http. This makes the metadata
      // upsert and file content mutations atomic: a crash between them can no
      // longer leave metadata at a new version with stale file content.
      const metadataStmt = db
        .insert(workItemGitState)
        .values({
          work_item_id,
          captured_at: capturedAt,
          branch_name: parsed.data.branch_name,
          files: parsed.data.files,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: workItemGitState.work_item_id,
          set: {
            version: sql`${workItemGitState.version} + 1`,
            captured_at: capturedAt,
            branch_name: parsed.data.branch_name,
            files: parsed.data.files,
            updated_at: new Date(),
          },
          setWhere: sql`excluded.captured_at >= ${workItemGitState.captured_at}`,
        })
        .returning({
          version: workItemGitState.version,
          captured_at: workItemGitState.captured_at,
        });

      const deleteStmt =
        toDelete.length > 0
          ? db
              .delete(workItemGitFiles)
              .where(
                and(
                  eq(workItemGitFiles.work_item_id, work_item_id),
                  inArray(workItemGitFiles.path, toDelete)
                )
              )
          : null;

      const upsertStmt =
        toUpsert.length > 0
          ? db
              .insert(workItemGitFiles)
              .values(toUpsert.map((c) => ({ work_item_id, ...c })))
              .onConflictDoUpdate({
                target: [workItemGitFiles.work_item_id, workItemGitFiles.path],
                set: {
                  original: sql`excluded.original`,
                  modified: sql`excluded.modified`,
                  content_hash: sql`excluded.content_hash`,
                },
              })
          : null;

      // db.batch = one non-interactive transaction on neon-http. Batching the
      // metadata upsert with file mutations makes the entire push atomic.
      // When there are no file mutations, the metadata upsert runs alone.
      let accepted: { version: number; captured_at: Date } | undefined;
      if (deleteStmt && upsertStmt) {
        const [metaResult] = await db.batch([metadataStmt, deleteStmt, upsertStmt]);
        accepted = metaResult[0];
      } else if (deleteStmt) {
        const [metaResult] = await db.batch([metadataStmt, deleteStmt]);
        accepted = metaResult[0];
      } else if (upsertStmt) {
        const [metaResult] = await db.batch([metadataStmt, upsertStmt]);
        accepted = metaResult[0];
      } else {
        const [row] = await metadataStmt;
        accepted = row;
      }

      if (!accepted) {
        // Out-of-order capture (an older captured_at lost the race): the stored
        // snapshot is newer, so the file rows must not be replaced either.
        res.status(200).json({ superseded: true });
        return;
      }

      const ping: GitStateUpdatedServerEvent = {
        type: 'git_state_updated',
        payload: {
          work_item_id,
          version: accepted.version,
          captured_at: accepted.captured_at.toISOString(),
          branch_name: parsed.data.branch_name,
        },
      };
      connectionManager.broadcastToRoom(workItemRoomId(work_item_id), ping);

      res.json({ version: accepted.version, captured_at: accepted.captured_at.toISOString() });
    }
  );

  return gitStateRouter;
}
