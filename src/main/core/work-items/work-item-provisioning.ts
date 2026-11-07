import { and, eq } from 'drizzle-orm';
import { workItemProvisionChangedChannel } from '@shared/events/workItemEvents';
import {
  serializeProvisionError,
  type LaneProvisionError,
} from '@shared/work-item-provision-error';
import { readRepoOrigin } from '@main/core/repos/repo-remotes';
import { appSettingsService } from '@main/core/settings/settings-service';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { notifyLaneChanged } from '@main/core/worktrees/lane-readiness';
import { runLaneSetup } from '@main/core/worktrees/lane-setup';
import { acquireWorktreeWorkspace } from '@main/core/worktrees/workspace-bridge';
import { scheduleWorktreeCloudSync } from '@main/core/worktrees/worktree-cloud-sync';
import { getPrimaryWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { toCloudWorkItemCreateBody } from './cloud-work-items-client';
import type { LaneCheckoutRequest } from './lane-checkout';
import { syncQueueService } from './sync-queue-service';
import { provisionWorkItemWorktree } from './work-item-worktree';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function markProvisionFailed(id: string, error: LaneProvisionError): Promise<void> {
  log.warn('[work-items] worktree provisioning failed', { workItemId: id, error });
  await db
    .update(workItems)
    .set({
      provisionStatus: 'failed',
      provisionError: serializeProvisionError(error),
      updatedAt: nowSeconds(),
    })
    .where(eq(workItems.id, id));
  events.emit(workItemProvisionChangedChannel, {
    workItemId: id,
    provisionStatus: 'failed',
    error,
  });
}

/**
 * The background half of creation: acquires the worktree, swaps repoPath from
 * the repo root to it, and only then registers the item with the cloud. Reads
 * its inputs from the row (not captured args) so retry-after-failure and
 * create share one path — and so a rename during provisioning reaches the
 * cloud create.
 */
export async function runWorkItemProvisioning(
  id: string,
  options: {
    allowLocalCopy: boolean;
    /** Retry of an interrupted create: use the checkout it left in the pool (devstation-dq2). */
    resumeInterrupted: boolean;
  }
): Promise<void> {
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!row) return; // deleted while provisioning — nothing to do

  try {
    // The request is read back from the primary row, so a Retry repeats
    // exactly what was asked for at creation.
    const requested = getPrimaryWorktreeRow(id);
    const branchName = row.branchName ?? requested.branchName;
    if (!branchName) throw new Error(`Work item ${id} has no branch to provision`);
    const request: LaneCheckoutRequest =
      requested.branchOrigin === 'user'
        ? { kind: 'existing', branchName }
        : requested.baseBranch
          ? { kind: 'new', branchName, baseRef: requested.baseBranch }
          : { kind: 'new', branchName };

    const worktree = await provisionWorkItemWorktree({
      repoPath: row.repoPath,
      repoLabel: row.repoAlias ?? row.repoPath,
      repoId: row.repoId,
      request,
      allowLocalCopy: options.allowLocalCopy,
      resumeInterrupted: options.resumeInterrupted,
    });
    if (!worktree.success) {
      await markProvisionFailed(id, worktree.error);
      return;
    }
    const lane = worktree.data;
    // Read before the row turns ready: an edit made once it is ready is
    // patched, and must find this create already queued to merge into. The
    // checkout shares its repo's remotes.
    const repoRemoteUrl = await readRepoOrigin(lane.worktreePath);

    // The work item and its primary worktree row move to the new checkout
    // together — see createWorkItem for why the primary exists from the start.
    db.transaction((tx) => {
      tx.update(workItems)
        .set({
          repoPath: lane.worktreePath,
          branchName: lane.branchName,
          provisionStatus: 'ready',
          provisionError: null,
          updatedAt: nowSeconds(),
        })
        .where(eq(workItems.id, id))
        .run();
      tx.update(workItemWorktrees)
        .set({
          path: lane.worktreePath,
          branchName: lane.branchName,
          targetRef: lane.targetRef,
          forkSha: lane.forkSha,
          slug: lane.slug,
          branchOrigin: lane.branchOrigin,
          forkSource: lane.forkSource,
          companionPath: lane.companionPath,
          companionRepoPath: lane.companionRepoPath,
          setupStatus: 'pending',
        })
        .where(and(eq(workItemWorktrees.workItemId, id), eq(workItemWorktrees.isPrimary, 1)))
        .run();
    });

    const [current] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
    if (!current) return; // deleted between update and read

    const { defaultWorkItemAccess } = await appSettingsService.get('sharing');
    syncQueueService.enqueueCreate(
      toCloudWorkItemCreateBody(
        {
          id,
          name: current.name,
          status: current.status,
          repoAlias: current.repoAlias,
          repoRemoteUrl,
          branchName: current.branchName,
          agentProvider: current.agentProvider,
        },
        defaultWorkItemAccess
      )
    );

    events.emit(workItemProvisionChangedChannel, { workItemId: id, provisionStatus: 'ready' });

    // Primary row now points at the fresh checkout: publish worktree metadata
    // (a no-op until the item is a sync target) and register the workspace so
    // `rpc.git.*` / `rpc.fs.*` serve it. A registry failure only leaves the
    // panels without a backend until the next boot, so it must not mark
    // provisioning failed.
    scheduleWorktreeCloudSync(id);
    const primary = getPrimaryWorktreeRow(id);
    notifyLaneChanged(primary.id);
    try {
      await acquireWorktreeWorkspace(primary);
    } catch (error) {
      log.warn('[work-items] could not acquire workspace for new work item', {
        workItemId: id,
        worktreeId: primary.id,
        error: String(error),
      });
    }
    // Setup records its own outcome (setup_status + log) and never rejects.
    void runLaneSetup(primary.id, askScriptApproval);
  } catch (cause) {
    await markProvisionFailed(id, { type: 'unexpected', message: String(cause) });
  }
}
