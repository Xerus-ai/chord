import {
  resolveArtifactAccess,
  resolveWorkItemAccess,
  roleAtLeast,
} from '../access/resolve-access.js';
import { DEV_MODE } from '../middleware/auth.js';
import type { AuthenticatedWebSocket } from './connection-manager.js';

const WORK_ITEM_ROOM_PREFIX = 'work_item:';
const ARTIFACT_ROOM_PREFIX = 'artifact:';

export function workItemRoomId(workItemId: string): string {
  return `${WORK_ITEM_ROOM_PREFIX}${workItemId}`;
}

/** The room for an artifact's own events (comments), open to artifact-only members too. */
export function artifactRoomId(artifactId: string): string {
  return `${ARTIFACT_ROOM_PREFIX}${artifactId}`;
}

function granted(access: Awaited<ReturnType<typeof resolveWorkItemAccess>>): boolean {
  return access !== null && access !== 'not_found';
}

/**
 * Authorizes joining a room. `work_item:<id>` needs work-item access (any
 * role — the room is the read/presence channel, not a write grant);
 * `artifact:<id>` needs artifact access, which artifact-only members have.
 * Any other name is denied.
 */
export async function authorizeRoomJoin(
  ws: AuthenticatedWebSocket,
  roomId: string
): Promise<boolean> {
  if (DEV_MODE) return true;
  if (roomId.startsWith(WORK_ITEM_ROOM_PREFIX)) {
    const workItemId = roomId.slice(WORK_ITEM_ROOM_PREFIX.length);
    return granted(await resolveWorkItemAccess(ws.user.userId, workItemId));
  }
  if (roomId.startsWith(ARTIFACT_ROOM_PREFIX)) {
    const artifactId = roomId.slice(ARTIFACT_ROOM_PREFIX.length);
    const access = await resolveArtifactAccess(ws.user.userId, artifactId);
    return access !== null && access !== 'not_found';
  }
  return false;
}

/**
 * Authorizes a read-level WS event scoped to a work item (any role). Room
 * membership is the fast path: joining required the same check, and a
 * sharing change evicts members who lost access (recheck-live-access.ts).
 */
export async function authorizeWorkItemEvent(
  ws: AuthenticatedWebSocket,
  workItemId: string
): Promise<boolean> {
  if (DEV_MODE) return true;
  if (ws.rooms.has(workItemRoomId(workItemId))) return true;
  return granted(await resolveWorkItemAccess(ws.user.userId, workItemId));
}

/**
 * Authorizes a WS event that MUTATES a work item's shared content: Can edit
 * or the author. No room fast path — viewers join the same rooms as editors.
 */
export async function authorizeWorkItemWrite(
  ws: AuthenticatedWebSocket,
  workItemId: string
): Promise<boolean> {
  if (DEV_MODE) return true;
  const access = await resolveWorkItemAccess(ws.user.userId, workItemId);
  return access !== null && access !== 'not_found' && roleAtLeast(access.role, 'edit');
}
