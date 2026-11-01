import { eq } from 'drizzle-orm';
import {
  selectLatestPublishedVersion,
  selectVersionMetadata,
} from '../../artifact-version-reads.js';
import { db } from '../../db/client.js';
import { artifacts } from '../../db/schema-artifacts.js';
import {
  ARTIFACT_DOC_PREFIX,
  readCurrentDocumentState,
  saveVersionSnapshot,
} from '../../hocuspocus.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import type { ConnectionManager } from '../../ws/connection-manager.js';
import { announceVersionCreated } from '../announce-version-created.js';

const LINK_VERSION_LABEL = 'Public link created';

/**
 * A document's public link shows its latest `manual` or `agent_milestone`
 * version, never live state (P6 §9 decision 3). Turning the link on for a
 * document with no such version saves one from the document as it stands
 * now (readCurrentDocumentState: the loaded Y.Doc, else the stored state), so
 * the link shows what the author saw when sharing it. A document with no
 * state at all has nothing to publish: its link says "not published yet".
 * Pages and images are published through their uploaded views instead.
 */
export async function saveLinkVersion(
  connectionManager: ConnectionManager,
  workItemId: string,
  artifactId: string,
  author: AuthenticatedRequest['user']
): Promise<void> {
  const [artifact] = await db
    .select({ render_class: artifacts.render_class })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);
  if (!artifact) throw new Error(`[sharing] artifact vanished mid-request: ${artifactId}`);
  if (artifact.render_class !== 'document') return;
  if (await selectLatestPublishedVersion(artifactId)) return;

  const documentName = `${ARTIFACT_DOC_PREFIX}${artifactId}`;
  const state = await readCurrentDocumentState(documentName);
  if (!state) return;

  const saved = await saveVersionSnapshot({
    documentName,
    update: state,
    authorId: author.userId,
    authorName: author.email,
    trigger: 'manual',
    label: LINK_VERSION_LABEL,
    baseVersion: null,
    clientVersionId: null,
  });
  if (saved.status !== 'saved') {
    throw new Error(`[sharing] link version for ${artifactId} was not stored: ${saved.status}`);
  }
  announceVersionCreated(
    connectionManager,
    workItemId,
    await selectVersionMetadata(saved.versionId)
  );
}
