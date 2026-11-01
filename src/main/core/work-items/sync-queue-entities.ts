import type {
  CloudChatBulkMessage,
  CloudGitStatePutBody,
  CloudSessionsPutBody,
  CloudWorktreesPutBody,
  PermissionRequestPutBody,
  PlanRequestPutBody,
} from '@chord/protocol';
import type {
  ArtifactVersionUploadPayload,
  CloudArtifactCreatePayload,
} from '@main/core/artifacts/cloud-artifacts-client';
import type { CloudWorkItemCreateBody, CloudWorkItemPatchBody } from './cloud-work-items-client';

/**
 * The entities the durable sync queue carries (sync-queue-service.ts): the
 * payload each one stores, which of them hang off a work item, and how a new
 * payload merges into one already pending.
 */

export interface ChatMessageBulkQueuePayload {
  messages: CloudChatBulkMessage[];
}

/** The comments themselves are read from the device when the row drains. */
export interface ArtifactCommentImportQueuePayload {
  work_item_id: string;
  artifact_id: string;
}

/**
 * Payload shape per queue entity type — mergeOrInsert is generic over this so
 * a payload can never be enqueued under the wrong entity. Work-item payloads
 * are stored in WIRE SHAPE (snake_case): an update spread-merged into a
 * pending create must produce keys the send path actually transmits.
 */
export interface SyncPayloadByEntity {
  work_item: Omit<CloudWorkItemCreateBody, 'id'> | CloudWorkItemPatchBody;
  artifact: CloudArtifactCreatePayload;
  // entityId is the local version id (the upload's client_version_id); one
  // row per version, never merged. Drains after its artifact's create
  // (sync-queue-eligible-rows.ts).
  artifact_version_upload: ArtifactVersionUploadPayload;
  // entityId is the artifactId: device comments left behind once the artifact
  // synced (devstation-85y). Drains after its artifact's create.
  artifact_comment_import: ArtifactCommentImportQueuePayload;
  chat_message_bulk: ChatMessageBulkQueuePayload;
  git_state: CloudGitStatePutBody;
  // One row per work item, like git_state: entityId is the workItemId and a
  // newer snapshot wholesale-replaces any pending one (T0.8).
  worktrees: CloudWorktreesPutBody;
  // One row per work item, same latest-wins whole-replace as worktrees: the
  // registry of the item's chat threads that a participant renders as tabs.
  sessions: CloudSessionsPutBody;
  // entityId is the SDK requestId (many rows per work item, unlike the two
  // one-row-per-item entities above); work_item_id always rides the payload
  // so sends can route and purgeChildOperations can match.
  permission_request: PermissionRequestPutBody;
  plan_request: PlanRequestPutBody;
}

export type SyncEntityType = keyof SyncPayloadByEntity;

/**
 * Entity types whose cloud parent is the work item row: a 404 from their send
 * means the parent has not reached the cloud yet (or is gone) — requeue
 * without consuming a retry. They never drain while the parent's create is
 * still queued (sync-queue-eligible-rows.ts).
 */
export const WORK_ITEM_CHILD_ENTITIES: ReadonlySet<SyncEntityType> = new Set([
  'chat_message_bulk',
  'git_state',
  'worktrees',
  'sessions',
  'permission_request',
  'plan_request',
  // Keyed by artifactId (many rows per work item), but its cloud parent is
  // still the work item — a 404 means the parent is missing, and a deleted
  // parent must purge queued artifact rows or they fail forever as ghosts.
  'artifact',
  // A 404 on a version upload is the same missing parent: the work item (or
  // the artifact, whose create the eligibility query already waits for).
  'artifact_version_upload',
  'artifact_comment_import',
]);

export function mergeQueuePayloads<E extends SyncEntityType>(
  entityType: E,
  existing: SyncPayloadByEntity[E],
  incoming: SyncPayloadByEntity[E]
): SyncPayloadByEntity[E] {
  if (entityType === 'chat_message_bulk') {
    // Append + dedupe by id. A shallow spread would REPLACE the messages
    // array and silently drop every message from the earlier enqueue.
    const previous = existing as ChatMessageBulkQueuePayload;
    const next = incoming as ChatMessageBulkQueuePayload;
    const byId = new Map(previous.messages.map((m) => [m.id, m]));
    for (const message of next.messages) byId.set(message.id, message);
    return { messages: [...byId.values()] } as SyncPayloadByEntity[E];
  }
  if (entityType === 'git_state' || entityType === 'worktrees' || entityType === 'sessions') {
    // Whole-snapshot replace: the latest capture/list supersedes any pending
    // one — a spread-merge could pair one capture's files with another's
    // contents (git_state), or resurrect a worktree the newer list no longer
    // has (worktrees and sessions, which are themselves full-replace bulk
    // upserts).
    return incoming;
  }
  // work_item and permission_request both WANT the spread: an update merged
  // into a pending create yields one request — for permission_request that
  // is a terminal-status create, which is how a request resolved before its
  // create ever reached the cloud arrives as a single settled upsert.
  return { ...existing, ...incoming };
}
