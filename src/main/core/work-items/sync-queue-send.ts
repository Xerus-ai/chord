import type {
  CloudGitStatePutBody,
  CloudSessionsPutBody,
  CloudWorktreesPutBody,
  PermissionRequestPutBody,
  PlanRequestPutBody,
} from '@chord/protocol';
import { eq, inArray } from 'drizzle-orm';
import {
  uploadCloudArtifactVersion,
  type ArtifactVersionUploadPayload,
  type CloudArtifactCreatePayload,
} from '@main/core/artifacts/cloud-artifacts-client';
import { pushChatMessagesBulk } from '@main/core/chat-messages/cloud-chat-client';
import {
  pushCloudPermissionRequest,
  pushCloudPlanRequest,
} from '@main/core/commands/cloud-commands-client';
import { db } from '@main/db/client';
import type { SyncQueueRow } from '@main/db/schema-sync';
import { chatMessages, workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import {
  createCloudWorkItem,
  deleteCloudWorkItem,
  pushCloudGitState,
  pushCloudSessions,
  pushCloudWorktrees,
  updateCloudWorkItem,
  type CloudWorkItemCreateBody,
  type CloudWorkItemPatchBody,
  type SendResult,
} from './cloud-work-items-client';
import { deliverArtifactCreate, deliverCommentImport } from './sync-queue-artifact-sends';
import type {
  ArtifactCommentImportQueuePayload,
  ChatMessageBulkQueuePayload,
  SyncEntityType,
} from './sync-queue-entities';
import { markWorkItemOwnedByAnotherAccount } from './work-item-account-ownership';
import { announceWorkItemCloudCreated } from './work-item-cloud-created';

/**
 * Sending one sync-queue row to the cloud, by entity and operation (split from
 * sync-queue-service.ts, devstation-eea).
 */

// SQLite bind-parameter limit is 999; stamp synced_at in bounded batches.
const SYNC_STAMP_BATCH = 500;

type SyncOperation = 'create' | 'update' | 'delete';

// Thrown by sendSyncOperation for a row that can NEVER succeed — an unsupported
// operation/entity combination, or a payload the client itself produced wrong.
// The drain loop marks these 'failed' immediately instead of reverting them to
// 'pending', which is what a genuine (transient) network throw does. Without
// this split a single poison row — always eligible because a bare revert never
// stamps lastAttemptedAt, and always first because it sorts by ascending id —
// re-throws every cycle and blocks every later op behind it forever.
export class NonRetryableSyncError extends Error {}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Sends one queued operation to the cloud. `onArtifactRegistered` runs after
 * an artifact's register succeeds (its device comments are then imported).
 */
export async function sendSyncOperation(
  row: SyncQueueRow,
  orgId: string | null,
  onArtifactRegistered: (workItemId: string, artifactId: string) => void
): Promise<SendResult> {
  const operation = row.operation as SyncOperation;
  const entityType = row.entityType as SyncEntityType;

  if (entityType === 'artifact') {
    if (operation !== 'create') {
      throw new NonRetryableSyncError(`Unsupported artifact sync operation: ${row.operation}`);
    }
    const payload = JSON.parse(row.payload) as CloudArtifactCreatePayload;
    // A row queued before render classes existed would register a page as a
    // document and hand it a Yjs room. Fail it out; the next startup
    // reconcileLocalArtifacts re-enqueues the still-unsynced artifact with
    // its render class.
    if (!payload.render_class) {
      throw new NonRetryableSyncError(
        `Artifact create payload has no render_class: ${row.entityId}`
      );
    }
    return deliverArtifactCreate(row.entityId, payload, () =>
      onArtifactRegistered(payload.work_item_id, row.entityId)
    );
  }

  if (entityType === 'artifact_comment_import') {
    if (operation !== 'create') {
      throw new NonRetryableSyncError(`Unsupported comment import operation: ${row.operation}`);
    }
    return deliverCommentImport(JSON.parse(row.payload) as ArtifactCommentImportQueuePayload);
  }

  if (entityType === 'artifact_version_upload') {
    if (operation !== 'create') {
      throw new NonRetryableSyncError(`Unsupported version upload operation: ${row.operation}`);
    }
    return uploadCloudArtifactVersion(JSON.parse(row.payload) as ArtifactVersionUploadPayload);
  }

  if (entityType === 'chat_message_bulk') {
    if (operation !== 'update') {
      throw new NonRetryableSyncError(`Unsupported chat sync operation: ${row.operation}`);
    }
    const payload = JSON.parse(row.payload) as ChatMessageBulkQueuePayload;
    const result = await pushChatMessagesBulk(row.entityId, payload.messages);
    if (result.ok) {
      const stampedAt = nowSeconds();
      const ids = payload.messages.map((m) => m.id);
      for (let i = 0; i < ids.length; i += SYNC_STAMP_BATCH) {
        db.update(chatMessages)
          .set({ syncedAt: stampedAt })
          .where(inArray(chatMessages.id, ids.slice(i, i + SYNC_STAMP_BATCH)))
          .run();
      }
    }
    return result;
  }

  if (entityType === 'git_state') {
    if (operation !== 'update') {
      throw new NonRetryableSyncError(`Unsupported git-state sync operation: ${row.operation}`);
    }
    // Nothing to stamp locally: the snapshot has no local table, and the
    // capture service's fingerprint map already prevents re-pushes.
    return pushCloudGitState(row.entityId, JSON.parse(row.payload) as CloudGitStatePutBody);
  }

  if (entityType === 'worktrees') {
    if (operation !== 'update') {
      throw new NonRetryableSyncError(`Unsupported worktrees sync operation: ${row.operation}`);
    }
    // Nothing to stamp locally: worktree-cloud-sync.ts's debounce already
    // prevents redundant re-pushes, and the local work_item_worktrees rows
    // carry no "synced" flag of their own (unlike artifact/chat_message).
    return pushCloudWorktrees(row.entityId, JSON.parse(row.payload) as CloudWorktreesPutBody);
  }

  if (entityType === 'sessions') {
    if (operation !== 'update') {
      throw new NonRetryableSyncError(`Unsupported sessions sync operation: ${row.operation}`);
    }
    // Nothing to stamp locally, as with worktrees: session-cloud-sync.ts's
    // debounce prevents redundant re-pushes and agent_sessions carries no
    // "synced" flag of its own.
    return pushCloudSessions(row.entityId, JSON.parse(row.payload) as CloudSessionsPutBody);
  }

  if (entityType === 'permission_request') {
    // Create and update are the same idempotent PUT upsert — the payload's
    // status field is what distinguishes publication from retraction.
    // Nothing to stamp locally: published_permission_requests tracks
    // RESOLUTION state, not delivery (the queue row's existence is that).
    return pushCloudPermissionRequest(
      row.entityId,
      JSON.parse(row.payload) as PermissionRequestPutBody
    );
  }

  if (entityType === 'plan_request') {
    return pushCloudPlanRequest(row.entityId, JSON.parse(row.payload) as PlanRequestPutBody);
  }

  switch (operation) {
    case 'create': {
      if (!orgId) {
        // drainEligible never selects a work-item create without a
        // resolved org; reaching here is a filter bug, and the row itself
        // is fine — throw plain Error so it defers as transient rather
        // than failing out permanently.
        throw new Error('work_item create drained without a resolved org');
      }
      const payload = JSON.parse(row.payload) as Omit<CloudWorkItemCreateBody, 'id'>;
      const result = await createCloudWorkItem(orgId, { id: row.entityId, ...payload });
      if (!result.ok && result.status === 409) {
        // The id belongs to a different creator (routes/work-items.ts):
        // this local row is another account's — the one that was signed in
        // on this profile when it was made and synced, before a sign-out and
        // a sign-in as someone else (local data outlives sign-out; the field
        // case was 13 items made under one account and reconciled under the
        // next). Settled, not failed: the row is marked, everything queued
        // for it is dropped, and `ok` here only means "nothing more to send".
        markWorkItemOwnedByAnotherAccount(row.entityId);
        log.info('[sync-queue] work item belongs to another account; not synced', {
          id: row.entityId,
          body: result.body,
        });
        return { ok: true };
      }
      if (!result.ok) return result;
      // The cloud has this row under this account (fresh, or already there
      // from an earlier delivery): record that, as the artifact create does
      // above. Without the stamp every local item read as never-synced,
      // and nothing distinguished "not yet delivered" from "delivered".
      db.update(workItems)
        .set({
          cloudId: row.entityId,
          syncedAt: nowSeconds(),
          cloudVersion: result.version_number,
        })
        .where(eq(workItems.id, row.entityId))
        .run();
      announceWorkItemCloudCreated(row.entityId);
      return { ok: true };
    }
    case 'update':
      return sendWorkItemUpdate(row.entityId, JSON.parse(row.payload) as CloudWorkItemPatchBody);
    case 'delete':
      return deleteCloudWorkItem(row.entityId);
    default:
      throw new NonRetryableSyncError(`Unknown sync operation: ${row.operation}`);
  }
}

/**
 * CAS retry (ARCH-3b): sends the row's last-known cloudVersion as
 * expected_version. A 409 means another writer committed first — refetch
 * the version the server just told us about (from the 409 body, not a
 * separate GET) and retry ONCE immediately, not through the normal
 * backoff ladder (a CAS miss isn't a transient server problem the way a
 * 5xx is — waiting won't help, having the fresh version might). If the
 * retry ALSO 409s, give up: two conflicts in a row means another writer is
 * racing faster than we can catch up, and a third blind attempt would be
 * exactly the silent clobber this mechanism exists to prevent. `expected_
 * version` is computed fresh on every attempt from the local row, never
 * baked into the queued payload, so a row that sits pending across several
 * drain cycles (backoff, offline) always CASes against the latest version
 * this client has actually seen.
 */
async function sendWorkItemUpdate(
  id: string,
  payload: CloudWorkItemPatchBody
): Promise<SendResult> {
  const stampVersion = (version: number): void => {
    db.update(workItems).set({ cloudVersion: version }).where(eq(workItems.id, id)).run();
  };

  const attempt = (expectedVersion: number | undefined) =>
    updateCloudWorkItem(
      id,
      expectedVersion !== undefined ? { ...payload, expected_version: expectedVersion } : payload
    );

  const local = db
    .select({ cloudVersion: workItems.cloudVersion })
    .from(workItems)
    .where(eq(workItems.id, id))
    .get();

  const first = await attempt(local?.cloudVersion ?? undefined);
  if (first.ok) {
    stampVersion(first.version_number);
    return { ok: true };
  }
  if (first.status !== 409) {
    return { ok: false, status: first.status, body: first.body };
  }

  log.warn('[sync-queue] work item PATCH version conflict, retrying once', {
    entityId: id,
    knownVersion: local?.cloudVersion ?? null,
    serverVersion: first.currentVersion ?? null,
  });
  if (first.currentVersion !== undefined) stampVersion(first.currentVersion);

  const second = await attempt(first.currentVersion);
  if (second.ok) {
    stampVersion(second.version_number);
    return { ok: true };
  }
  if (second.status !== 409) {
    return { ok: false, status: second.status, body: second.body };
  }

  return {
    ok: false,
    status: 409,
    body: 'Update conflicted with a newer version twice in a row; local changes were not applied. Refresh and retry.',
    terminal: true,
  };
}
