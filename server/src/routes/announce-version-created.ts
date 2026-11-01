import type { VersionMetadata } from '../artifact-version-reads.js';
import { artifactRoomId, workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * Tells open viewers a version was stored (P6 §9): the work-item room for
 * people on the work item, the artifact room for people the artifact alone
 * was shared with. Receivers refetch the version list and, for a page with a
 * view, reload the frame.
 */
export function announceVersionCreated(
  connectionManager: ConnectionManager,
  workItemId: string,
  version: VersionMetadata
): void {
  const event = {
    type: 'artifact_version_created' as const,
    payload: {
      work_item_id: workItemId,
      artifact_id: version.artifact_id,
      version_id: version.id,
      version_number: version.version_number,
      trigger: parseTrigger(version.trigger),
      has_view: version.has_view,
    },
  };
  connectionManager.broadcastToRoom(workItemRoomId(workItemId), event);
  connectionManager.broadcastToRoom(artifactRoomId(version.artifact_id), event);
}

function parseTrigger(trigger: string): 'auto' | 'manual' | 'agent_milestone' {
  if (trigger === 'auto' || trigger === 'manual' || trigger === 'agent_milestone') return trigger;
  throw new Error(`[versions] unknown version trigger: ${trigger}`);
}
