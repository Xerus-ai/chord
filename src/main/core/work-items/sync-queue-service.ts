import type {
  CloudChatBulkMessage,
  CloudGitStatePutBody,
  CloudSessionsPutBody,
  CloudWorktreesPutBody,
  PermissionRequestPutBody,
  PlanRequestPutBody,
} from '@chord/protocol';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { isOwnedByAnotherAccount } from '@shared/work-item-ownership';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { serverTraffic } from '@main/core/app/server-traffic';
import type {
  ArtifactVersionUploadPayload,
  CloudArtifactCreatePayload,
} from '@main/core/artifacts/cloud-artifacts-client';
import { db } from '@main/db/client';
import { syncQueue, type SyncQueueRow } from '@main/db/schema-sync';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import {
  resolveOrgId,
  type CloudWorkItemCreateBody,
  type CloudWorkItemPatchBody,
} from './cloud-work-items-client';
import { drainEligibleRows } from './sync-queue-drain';
import {
  collapseDuplicateFailedCreates,
  reviveCreatesFailedOnConflict,
} from './sync-queue-failed-rows';
import { syncQueueHealth } from './sync-queue-health';
import { OwedReconciles } from './sync-queue-owed-reconciles';
import {
  reconcileLocalArtifactRows,
  reconcileLocalChatRows,
  reconcileLocalWorkItemRows,
} from './sync-queue-reconcile';
import {
  insertWorkItemDeleteRow,
  mergeOrInsertQueueRow,
  queueArtifactCommentImport,
} from './sync-queue-writes';
import {
  purgeOperationsOwnedByAnotherAccount,
  workItemBelongsToAnotherAccount,
} from './work-item-account-ownership';

const PROCESS_INTERVAL_MS = 30_000;
const PROCESS_KICK_DELAY_MS = 500;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Durable, retrying replacement for fire-and-forget cloud sync. Work item
 * mutations are persisted to the `sync_queue` table and drained against the
 * cloud API with exponential backoff. Pending operations for the same work
 * item are deduplicated so a create+update collapses into a single request.
 */
export class SyncQueueService implements IInitializable, IDisposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private unsubscribeTraffic: (() => void) | null = null;
  private readonly owed = new OwedReconciles(
    {
      workItems: () => this.reconcileLocalWorkItems(),
      artifacts: () => this.reconcileLocalArtifacts(),
      chatMessages: () => this.reconcileLocalChatMessages(),
    },
    () => this.scheduleProcessing()
  );

  initialize(): void {
    this.unsubscribeTraffic = serverTraffic.subscribe((open) => {
      if (!open) return;
      syncQueueHealth.recordResume(nowSeconds());
      void this.owed.runOwed();
    });
    this.resetInterruptedOperations();
    const collapsed = collapseDuplicateFailedCreates();
    if (collapsed > 0) {
      log.info('[sync-queue] collapsed duplicate failed create rows', { removed: collapsed });
    }
    const revived = reviveCreatesFailedOnConflict();
    if (revived > 0) {
      log.info('[sync-queue] revived rows an older build failed on a 409 create', { revived });
    }
    this.timer = setInterval(() => {
      void this.processQueue();
    }, PROCESS_INTERVAL_MS);
    void this.processQueue();
  }

  dispose(): void {
    this.unsubscribeTraffic?.();
    this.unsubscribeTraffic = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.kickTimer) {
      clearTimeout(this.kickTimer);
      this.kickTimer = null;
    }
  }

  enqueueCreate(body: CloudWorkItemCreateBody): void {
    const { id, ...rest } = body;
    mergeOrInsertQueueRow('work_item', 'create', id, rest);
    this.scheduleProcessing();
  }

  enqueueUpdate(id: string, body: CloudWorkItemPatchBody): void {
    if (Object.keys(body).length === 0) return;
    mergeOrInsertQueueRow('work_item', 'update', id, body);
    this.scheduleProcessing();
  }

  enqueueArtifactCreate(artifactId: string, payload: CloudArtifactCreatePayload): void {
    mergeOrInsertQueueRow('artifact', 'create', artifactId, payload);
    this.scheduleProcessing();
  }

  /** Queues one local version for upload (design 2026-09-24 §9 "Upload"). */
  enqueueArtifactVersionUpload(payload: ArtifactVersionUploadPayload): void {
    mergeOrInsertQueueRow('artifact_version_upload', 'create', payload.client_version_id, payload);
    this.scheduleProcessing();
  }

  /**
   * Queues the import of device comments an artifact still holds after it
   * synced (devstation-85y). One row per artifact; the comments are read when
   * it drains.
   */
  enqueueArtifactCommentImport(workItemId: string, artifactId: string): void {
    queueArtifactCommentImport(workItemId, artifactId);
    this.scheduleProcessing();
  }

  /**
   * Drops a deleted artifact's queued registration, version uploads and
   * comment import, so it is never re-created in the cloud.
   */
  purgeArtifactOperations(artifactId: string): void {
    db.delete(syncQueue)
      .where(
        or(
          and(
            inArray(syncQueue.entityType, ['artifact', 'artifact_comment_import']),
            eq(syncQueue.entityId, artifactId)
          ),
          and(
            eq(syncQueue.entityType, 'artifact_version_upload'),
            sql`json_extract(${syncQueue.payload}, '$.artifact_id') = ${artifactId}`
          )
        )
      )
      .run();
  }

  /**
   * Queues chat rows for the creator-only bulk push. One queue row per work
   * item: repeated enqueues append + dedupe by message id into its payload.
   */
  enqueueChatMessages(workItemId: string, messages: CloudChatBulkMessage[]): void {
    if (messages.length === 0) return;
    mergeOrInsertQueueRow('chat_message_bulk', 'update', workItemId, { messages });
    this.scheduleProcessing();
  }

  /**
   * Queues a git snapshot for the creator-only PUT. One queue row per work
   * item: a newer capture wholesale-replaces any pending one.
   */
  enqueueGitState(workItemId: string, body: CloudGitStatePutBody): void {
    mergeOrInsertQueueRow('git_state', 'update', workItemId, body);
    this.scheduleProcessing();
  }

  /**
   * Queues the work item's full current worktree list for the bulk-replace
   * PUT (T0.8). One queue row per work item: a newer list wholesale-replaces
   * any pending one, same as enqueueGitState above.
   */
  enqueueSessions(workItemId: string, body: CloudSessionsPutBody): void {
    mergeOrInsertQueueRow('sessions', 'update', workItemId, body);
    this.scheduleProcessing();
  }

  enqueueWorktrees(workItemId: string, body: CloudWorktreesPutBody): void {
    mergeOrInsertQueueRow('worktrees', 'update', workItemId, body);
    this.scheduleProcessing();
  }

  /**
   * Queues the publication of an agent permission request (design §4) —
   * one queue row per requestId, unlike the per-work-item entities above.
   */
  enqueuePermissionRequestCreate(requestId: string, body: PermissionRequestPutBody): void {
    mergeOrInsertQueueRow('permission_request', 'create', requestId, body);
    this.scheduleProcessing();
  }

  /**
   * Queues the retraction (resolved/expired). Merging collapses it into a
   * still-pending create; otherwise it drains as its own PUT.
   */
  enqueuePermissionRequestUpdate(requestId: string, body: PermissionRequestPutBody): void {
    mergeOrInsertQueueRow('permission_request', 'update', requestId, body);
    this.scheduleProcessing();
  }

  enqueuePlanRequestCreate(requestId: string, body: PlanRequestPutBody): void {
    mergeOrInsertQueueRow('plan_request', 'create', requestId, body);
    this.scheduleProcessing();
  }

  enqueuePlanRequestUpdate(requestId: string, body: PlanRequestPutBody): void {
    mergeOrInsertQueueRow('plan_request', 'update', requestId, body);
    this.scheduleProcessing();
  }

  /**
   * `ownerAccountId` is the deleted row's owner_account_id, read by the caller
   * before the local row went away; omitted when the row still exists.
   * Another account's item is never deleted in the cloud from here.
   */
  enqueueDelete(id: string, ownerAccountId?: string | null): void {
    const foreign =
      ownerAccountId === undefined
        ? workItemBelongsToAnotherAccount(id, chordAccountService.getCachedUserId())
        : isOwnedByAnotherAccount(ownerAccountId, chordAccountService.getCachedUserId());
    if (foreign) {
      log.info('[sync-queue] delete not queued: work item belongs to another account', { id });
      return;
    }
    insertWorkItemDeleteRow(id);
    this.scheduleProcessing();
  }

  /** Startup backfill of local work items; see sync-queue-reconcile.ts. */
  async reconcileLocalWorkItems(): Promise<void> {
    if (this.owed.owe('workItems')) return;
    if (await reconcileLocalWorkItemRows()) this.scheduleProcessing();
  }

  /** Startup backfill of local artifacts and their device comments. */
  async reconcileLocalArtifacts(): Promise<void> {
    if (this.owed.owe('artifacts')) return;
    if (await reconcileLocalArtifactRows()) this.scheduleProcessing();
  }

  /** Startup backfill of never-synced local chat rows. */
  async reconcileLocalChatMessages(): Promise<void> {
    if (this.owed.owe('chatMessages')) return;
    if (await reconcileLocalChatRows()) this.scheduleProcessing();
  }

  getFailedOperations(): SyncQueueRow[] {
    return db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.status, 'failed'))
      .orderBy(desc(syncQueue.id))
      .all();
  }

  /**
   * Flips every failed op back to pending with a fresh retry budget. This is
   * the only recovery path in the app (no per-row retry), so it must also
   * reset firstOrphanedAt: an orphaned child that failed out after the grace
   * period gets a fresh orphan clock alongside its parent's fresh retry
   * budget, instead of immediately re-failing on its next 404.
   */
  retryAllFailed(): number {
    const failed = this.getFailedOperations();
    if (failed.length === 0) return 0;
    db.update(syncQueue)
      .set({
        status: 'pending',
        retryCount: 0,
        errorMessage: null,
        lastAttemptedAt: null,
        firstOrphanedAt: null,
      })
      .where(eq(syncQueue.status, 'failed'))
      .run();
    this.scheduleProcessing();
    return failed.length;
  }

  private resetInterruptedOperations(): void {
    db.update(syncQueue).set({ status: 'pending' }).where(eq(syncQueue.status, 'processing')).run();
  }

  private scheduleProcessing(): void {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.processQueue();
    }, PROCESS_KICK_DELAY_MS);
  }

  async processQueue(): Promise<void> {
    if (this.processing || !serverTraffic.isOpen()) return;
    this.processing = true;
    try {
      const session = await chordAccountService.getSession();
      if (session.authState !== 'signed_in') return;

      const purged = purgeOperationsOwnedByAnotherAccount(session.user!.userId);
      if (purged > 0) {
        log.info('[sync-queue] dropped queued operations for another account’s work items', {
          removed: purged,
        });
      }

      let orgId: string | null;
      try {
        orgId = await resolveOrgId();
      } catch (error) {
        log.warn('[sync-queue] deferring cycle, cloud unreachable', { error: String(error) });
        return;
      }
      syncQueueHealth.setOrgResolution(orgId !== null);
      // Paused while the org lookup was in flight: send nothing more this cycle.
      if (!serverTraffic.isOpen()) return;
      if (!orgId) {
        // Only org-scoped work-item creates need an org; everything else is
        // addressed by work-item/entity id and MUST still drain. A null org
        // used to silently bail the whole cycle right here, wedging 192 rows
        // behind the handful that actually needed one (NEW-6).
        log.warn('[sync-queue] org unresolved; draining non-org-scoped operations only');
      }

      await drainEligibleRows(orgId, (workItemId, artifactId) =>
        this.enqueueArtifactCommentImport(workItemId, artifactId)
      );
    } catch (error) {
      log.error('[sync-queue] processing cycle failed', { error: String(error) });
    } finally {
      this.processing = false;
    }
  }
}

export const syncQueueService = new SyncQueueService();
