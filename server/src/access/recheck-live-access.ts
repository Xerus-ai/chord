import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { artifacts } from '../db/schema-artifacts.js';
import { presence } from '../db/schema-sharing.js';
import { listArtifactDocumentConnections } from '../hocuspocus-connections.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';
import { invalidateWorkItemAccess } from './access-cache.js';
import { resolveArtifactAccess, resolveWorkItemAccess } from './resolve-access.js';

/**
 * Applies a sharing change to everything already open. Access is checked when
 * a WS room is joined or a Yjs document connects, never again — so after any
 * member, role or general-access change this re-resolves every live user of
 * the work item and its artifacts against the new state:
 *
 *   - lost work-item access  → removed from the work-item room, presence cleared
 *   - lost artifact access   → removed from the artifact room
 *   - Yjs connection whose mode no longer matches (lost access, edit → view,
 *     or view → edit) → closed; the client reconnects and is authorized again
 *
 * Cost is one cached resolver call per live user, not per member.
 */
export async function recheckLiveAccess(
  connectionManager: ConnectionManager,
  workItemId: string
): Promise<void> {
  invalidateWorkItemAccess(workItemId);

  const workItemRoom = workItemRoomId(workItemId);
  for (const userId of connectionManager.getRoomUserIds(workItemRoom)) {
    const access = await resolveWorkItemAccess(userId, workItemId);
    if (access !== null && access !== 'not_found') continue;
    connectionManager.removeUserFromRoom(userId, workItemRoom);
    await db
      .delete(presence)
      .where(and(eq(presence.work_item_id, workItemId), eq(presence.user_id, userId)));
  }

  const rows = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(eq(artifacts.work_item_id, workItemId));

  for (const { id: artifactId } of rows) {
    const artifactRoom = artifactRoomId(artifactId);
    for (const userId of connectionManager.getRoomUserIds(artifactRoom)) {
      const access = await resolveArtifactAccess(userId, artifactId);
      if (access === null || access === 'not_found') {
        connectionManager.removeUserFromRoom(userId, artifactRoom);
      }
    }

    for (const connection of listArtifactDocumentConnections(artifactId)) {
      if (!connection.userId) {
        connection.close();
        continue;
      }
      const access = await resolveArtifactAccess(connection.userId, artifactId);
      const allowed = access !== null && access !== 'not_found';
      if (!allowed || (access.role === 'view') !== connection.readOnly) connection.close();
    }
  }
}
