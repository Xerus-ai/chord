import type { CloudChatBulkMessage } from '@chord/protocol';
import { asc, eq, isNull } from 'drizzle-orm';
import { isOwnedByAnotherAccount } from '@shared/work-item-ownership';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { artifactRegisterPayload } from '@main/core/artifacts/artifact-register-payload';
import { listSyncedArtifactsWithDeviceComments } from '@main/core/artifacts/device-comments';
import { requireCreatedAtMs } from '@main/core/chat-messages/chat-row-time';
import { toCloudChatBulkMessage } from '@main/core/chat-messages/chat-wire-mapper';
import { originOf, readRepoOriginsById } from '@main/core/repos/repo-remotes';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { chatMessages, workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import {
  fetchCloudWorkItems,
  resolveOrgId,
  toCloudWorkItemCreateBody,
  type CloudWorkItemPatchBody,
} from './cloud-work-items-client';
import { mergeOrInsertQueueRow, queueArtifactCommentImport } from './sync-queue-writes';

/**
 * Startup reconciliation: what this machine holds that the cloud lacks, put
 * into the sync queue (split from sync-queue-service.ts, devstation-eea).
 * Each returns whether it queued anything, so the caller kicks a drain.
 */

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Startup reconciliation: pushes every local work item the cloud does not
 * yet have into the queue as a create, and backfills repo/branch metadata
 * onto cloud rows created before the payloads were widened (diffed against
 * the fetched cloud rows — never a blind re-push). Runs once the account
 * token is loaded. No-op when signed out or the cloud is unreachable.
 */
export async function reconcileLocalWorkItemRows(): Promise<boolean> {
  const session = await chordAccountService.getSession();
  if (session.authState !== 'signed_in') return false;

  let cloudRows: Awaited<ReturnType<typeof fetchCloudWorkItems>>;
  try {
    // resolveOrgId doubles as server-side org provisioning. A null answer
    // no longer skips reconcile: enqueued creates simply wait for an org
    // while backfill patches stay drainable (NEW-6 decoupling).
    await resolveOrgId();
    cloudRows = await fetchCloudWorkItems();
  } catch (error) {
    log.warn('[sync-queue] startup reconcile skipped, cloud unreachable', {
      error: String(error),
    });
    return false;
  }

  const userId = session.user!.userId;
  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const localItems = db.select().from(workItems).all();
  const { defaultWorkItemAccess } = await appSettingsService.get('sharing');
  const origins = await readRepoOriginsById(
    localItems.flatMap((item) => (item.repoId ? [item.repoId] : []))
  );
  let creates = 0;
  let backfills = 0;
  let skipped = 0;
  for (const item of localItems) {
    const cloud = cloudById.get(item.id);
    if (cloud) {
      // The listing is creator-scoped: this row is the signed-in account's
      // whatever it was marked before (a row marked another account's while
      // that account was signed in on this profile comes back here).
      if (item.ownerAccountId !== userId || item.cloudId === null) {
        db.update(workItems)
          .set({
            ownerAccountId: userId,
            cloudId: item.id,
            syncedAt: item.syncedAt ?? nowSeconds(),
          })
          .where(eq(workItems.id, item.id))
          .run();
      }
    } else if (isOwnedByAnotherAccount(item.ownerAccountId, userId)) {
      // Not this account's: nothing to send, nothing to fail.
      skipped += 1;
      continue;
    } else {
      if (item.ownerAccountId === null) {
        // Attribution decision for rows from before owner_account_id: the
        // first account that reconciles them. The server's answer to the
        // create then confirms it (200/201) or corrects it (409 →
        // OWNED_BY_ANOTHER_ACCOUNT, see sendOperation).
        db.update(workItems).set({ ownerAccountId: userId }).where(eq(workItems.id, item.id)).run();
      }
      const { id, ...rest } = toCloudWorkItemCreateBody(
        { ...item, repoRemoteUrl: originOf(origins, item.repoId) },
        defaultWorkItemAccess
      );
      mergeOrInsertQueueRow('work_item', 'create', id, rest);
      creates += 1;
      continue;
    }
    const patch: CloudWorkItemPatchBody = {};
    if (item.repoAlias !== null && cloud.repo_name !== item.repoAlias) {
      patch.repo_name = item.repoAlias;
    }
    if (item.branchName !== null && cloud.branch_name !== item.branchName) {
      patch.branch_name = item.branchName;
    }
    const origin = originOf(origins, item.repoId);
    if (origin !== null && cloud.repo_remote_url !== origin) {
      patch.repo_remote_url = origin;
    }
    if (Object.keys(patch).length > 0) {
      mergeOrInsertQueueRow('work_item', 'update', item.id, patch);
      backfills += 1;
    }
  }

  if (creates > 0 || backfills > 0) {
    log.info('[sync-queue] startup reconcile enqueued work-item ops', {
      creates,
      backfills,
      skippedOtherAccount: skipped,
      local: localItems.length,
      cloud: cloudRows.length,
    });
  }
  return creates > 0 || backfills > 0;
}

/**
 * Startup backfill: registers every never-synced local artifact with the
 * cloud (syncedAt is stamped on successful send). Idempotent server-side, so
 * no cloud-id diff is needed. Also queues the import of device comments a
 * synced artifact still holds, left behind by builds that synced artifacts
 * without them (devstation-85y). No-op when signed out.
 */
export async function reconcileLocalArtifactRows(): Promise<boolean> {
  const session = await chordAccountService.getSession();
  if (session.authState !== 'signed_in') return false;

  const stranded = listSyncedArtifactsWithDeviceComments();
  for (const { workItemId, artifactId } of stranded) {
    queueArtifactCommentImport(workItemId, artifactId);
  }

  const unsynced = db.select().from(artifacts).where(isNull(artifacts.syncedAt)).all();
  if (unsynced.length === 0) return stranded.length > 0;

  for (const artifact of unsynced) {
    mergeOrInsertQueueRow('artifact', 'create', artifact.id, artifactRegisterPayload(artifact));
  }

  log.info('[sync-queue] startup reconcile enqueued artifact creates', {
    enqueued: unsynced.length,
  });
  return true;
}

/**
 * Startup backfill for chat history: enqueues every never-synced local chat
 * row (synced_at stamped on successful push). Idempotent server-side by
 * message id, so no cloud diff is needed. No-op when signed out.
 */
export async function reconcileLocalChatRows(): Promise<boolean> {
  const session = await chordAccountService.getSession();
  if (session.authState !== 'signed_in') return false;

  const unsynced = db
    .select()
    .from(chatMessages)
    .where(isNull(chatMessages.syncedAt))
    .orderBy(asc(chatMessages.createdAtMs))
    .all();
  if (unsynced.length === 0) return false;

  const byWorkItem = new Map<string, CloudChatBulkMessage[]>();
  for (const row of unsynced) {
    const wire = toCloudChatBulkMessage({ ...row, createdAtMs: requireCreatedAtMs(row) });
    if (!wire) continue;
    let list = byWorkItem.get(row.workItemId);
    if (!list) {
      list = [];
      byWorkItem.set(row.workItemId, list);
    }
    list.push(wire);
  }

  for (const [workItemId, messages] of byWorkItem) {
    mergeOrInsertQueueRow('chat_message_bulk', 'update', workItemId, { messages });
  }

  log.info('[sync-queue] startup reconcile enqueued chat backfill', {
    messages: unsynced.length,
    workItems: byWorkItem.size,
  });
  return true;
}
