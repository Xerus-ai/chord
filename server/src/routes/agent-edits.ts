import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { resolveArtifactAccess, roleAtLeast } from '../access/resolve-access.js';
import { applyAgentEdit, type AgentEditOperation } from '../agent-yjs-client.js';
import { selectVersionMetadata } from '../artifact-version-reads.js';
import { db, hasDb } from '../db/client.js';
import { artifacts } from '../db/schema-artifacts.js';
import { ARTIFACT_DOC_PREFIX, saveVersionSnapshot } from '../hocuspocus.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { announceVersionCreated } from './announce-version-created.js';

const AgentEditOperationSchema = z.object({
  type: z.enum(['insert_text', 'delete_text', 'replace_text', 'insert_xml', 'set_map']),
  target: z.string().optional(),
  index: z.number().optional(),
  length: z.number().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  tag: z.string().optional(),
});

const ApplyAgentEditSchema = z.object({
  artifact_id: z.string(),
  operations: z.array(AgentEditOperationSchema).min(1),
  /**
   * Last batch of the agent's task: disconnect immediately after flushing so
   * presence drops, and save the result as an agent_milestone version.
   */
  final: z.boolean().default(false),
});

type AgentEditTarget =
  | { ok: true; workItemId: string | null }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * An agent edit is a Yjs operation, and only a document artifact has a Yjs
 * document — a page or a file (P6 §10) has none — the sync server refuses to open one. Resolved here so
 * the caller gets a clear 4xx instead of a 502 from a failed Yjs handshake.
 * Access is checked first so the answer never reveals another tenant's
 * artifact. No-DB dev mode has no artifact registry to consult.
 */
async function resolveAgentEditTarget(
  user: AuthenticatedRequest['user'],
  artifactId: string
): Promise<AgentEditTarget> {
  if (!hasDb) return { ok: true, workItemId: null };

  const access = await resolveArtifactAccess(user.userId, artifactId);
  if (access === null || access === 'not_found') {
    return { ok: false, status: 404, error: 'Artifact not found' };
  }
  if (!roleAtLeast(access.role, 'edit')) {
    return { ok: false, status: 403, error: 'Viewers have read-only access' };
  }
  const [artifact] = await db
    .select({ render_class: artifacts.render_class })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (!artifact) throw new Error(`[agent-edits] artifact vanished mid-request: ${artifactId}`);
  if (artifact.render_class === 'page') {
    return {
      ok: false,
      status: 400,
      error: 'Page artifacts have no collaboration document and cannot take agent edits',
    };
  }
  if (artifact.render_class !== 'document') {
    return {
      ok: false,
      status: 400,
      error: 'File artifacts have no collaboration document and cannot take agent edits',
    };
  }
  return { ok: true, workItemId: access.work_item_id };
}

export function createAgentEditsRouter(connectionManager: ConnectionManager): Router {
  const router = Router();

  /**
   * The final batch is a milestone (P6 §9 decision 4): the document as it
   * stood once the agent's edits flushed is saved as an agent_milestone
   * version and announced. No-DB dev mode keeps the snapshot on disk and has
   * no version row to announce.
   */
  async function saveAgentMilestone(
    user: AuthenticatedRequest['user'],
    artifactId: string,
    workItemId: string | null,
    state: Uint8Array
  ): Promise<void> {
    const saved = await saveVersionSnapshot({
      documentName: `${ARTIFACT_DOC_PREFIX}${artifactId}`,
      update: state,
      authorId: user.userId,
      authorName: user.email,
      trigger: 'agent_milestone',
      label: null,
      baseVersion: null,
      clientVersionId: null,
    });
    if (saved.status !== 'saved') {
      throw new Error(`[agent-edits] milestone for ${artifactId} was not stored: ${saved.status}`);
    }
    if (workItemId === null) return;
    const version = await selectVersionMetadata(saved.versionId);
    announceVersionCreated(connectionManager, workItemId, version);
  }

  router.post('/', async (req, res) => {
    const { user } = req as AuthenticatedRequest;
    const parsed = ApplyAgentEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { artifact_id: artifactId, final } = parsed.data;

    const target = await resolveAgentEditTarget(user, artifactId);
    if (!target.ok) {
      res.status(target.status).json({ error: target.error });
      return;
    }

    const hocuspocusPort = parseInt(process.env.HOCUSPOCUS_PORT || '1235', 10);

    let flushedState: Uint8Array;
    try {
      flushedState = await applyAgentEdit(
        artifactId,
        parsed.data.operations as AgentEditOperation[],
        {
          serverUrl: `ws://localhost:${hocuspocusPort}`,
          token: req.headers.authorization?.split(' ')[1] ?? '',
          final,
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent edit failed';
      console.error('[agent-edits] apply failed:', message);
      res.status(502).json({ error: message });
      return;
    }

    if (final) await saveAgentMilestone(user, artifactId, target.workItemId, flushedState);

    res.json({
      artifact_id: artifactId,
      operations_applied: parsed.data.operations.length,
      applied_by: user.userId,
    });
  });

  return router;
}
