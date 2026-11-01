import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { CreateWorkItemArgs } from '@shared/create-work-item';
import { workItemProvisionChangedChannel } from '@shared/events/workItemEvents';
import { err, ok, type Result } from '@shared/result';
import type { PullRequestCheckoutError } from '@shared/work-item-ticket';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { deleteWorkItemCheckpoints } from '@main/core/checkpoints/checkpoint-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { releaseWorkItemSoloForRemoval } from '@main/core/solo/solo-lane-removal';
import { comparablePath } from '@main/core/utils/comparable-path';
import { releaseArchiveRefs } from '@main/core/worktrees/lane-archive-git';
import { cancelLaneWaiters } from '@main/core/worktrees/lane-readiness';
import { releaseWorktreeWorkspace } from '@main/core/worktrees/workspace-bridge';
import { db } from '@main/db/client';
import {
  repos,
  workItems,
  workItemTickets,
  workItemWorktrees,
  type WorkItemRow,
} from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { BranchPrefixError } from './branch-prefix';
import { toCloudWorkItemPatchBody } from './cloud-work-items-client';
import {
  validateCreateWorkItemRequest,
  type InvalidCreateRequest,
} from './create-work-item-request';
import { gitStateCaptureService } from './git-state-capture';
import type { LanePreflightError, LanePreflightRequest } from './lane-preflight';
import { planProvisionRetry } from './provision-retry-plan';
import { checkOutPullRequestBranch } from './pull-request-checkout';
import type { RemoteTrackingBranchError } from './remote-tracking-branch';
import { repoIsOnDisk } from './repo-on-disk';
import { resolveBranchPrefix } from './resolve-branch-prefix';
import { stopWorkItemSessions } from './stop-checkout-sessions';
import { syncQueueService } from './sync-queue-service';
import type {
  DeleteWorkItemError,
  RetryProvisionError,
  RetryProvisionOptions,
  UpdateWorkItemArgs,
} from './work-item-crud-types';
import { runWorkItemProvisioning } from './work-item-provisioning';
import { createWorkItemTrackingBranch, preflightWorkItemLane } from './work-item-worktree';
import { buildWorkItemBranchName, removeLaneCheckout } from './work-item-worktree-git';

export type CreateWorkItemError =
  | { type: 'no_repo'; message: string }
  | InvalidCreateRequest
  | BranchPrefixError
  | LanePreflightError
  | PullRequestCheckoutError
  | RemoteTrackingBranchError;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The one create path. Everything the item starts with arrives in one request:
 * the name exactly as the dialog showed it, the id the dialog chose (so the
 * branch it previewed is this one), a ticket — written in the same
 * transaction, so no item is ever named after a ticket it isn't linked to —
 * and, for a fork PR, the pull ref to fetch into `existingBranch` first.
 */
export async function createWorkItem(
  args: CreateWorkItemArgs
): Promise<Result<{ item: WorkItemRow }, CreateWorkItemError>> {
  const request = validateCreateWorkItemRequest(args);
  if (!request.success) return request;

  let repoPath = args.repoPath ?? '';
  let repoAlias = args.repoAlias ?? null;
  const repoId: string | null = args.repoId ?? null;

  if (repoId) {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (repo) {
      repoPath = repo.path;
      repoAlias = repo.alias;
    }
  }

  if (!repoPath) return err({ type: 'no_repo' as const, message: 'A repository is required' });
  repoPath = resolve(repoPath);

  if (args.id) {
    const [taken] = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(eq(workItems.id, args.id))
      .limit(1);
    if (taken) {
      return err({
        type: 'invalid_request' as const,
        message: `Work item ${args.id} already exists`,
      });
    }
  }
  const id = args.id ?? randomUUID();
  const now = nowSeconds();

  // The work item runs in its own worktree, not the repo root — that is the
  // whole of its isolation from every other work item on the same repo. The
  // worktree is acquired in the background so creation hands over instantly;
  // until it lands, repoPath holds the repo root and provision_status
  // 'provisioning' makes agent execution refuse to start (send-to-agent and
  // the terminal paths gate on it), so nothing ever runs in the shared root.
  const existingBranch = args.existingBranch?.trim() || undefined;
  let branchName: string;
  if (existingBranch) {
    branchName = existingBranch;
  } else {
    const branchPrefix = await resolveBranchPrefix();
    if (!branchPrefix.success) return err(branchPrefix.error);
    branchName = buildWorkItemBranchName({
      name: args.name,
      workItemId: id,
      branchPrefix: branchPrefix.data,
    });
  }

  // A fork PR's branch exists only once its pull ref is fetched, and the
  // preflight below must find it like any other existing branch.
  if (args.pullRequest && existingBranch) {
    const fetched = await checkOutPullRequestBranch({
      repoPath,
      pullRequest: args.pullRequest,
      branchName: existingBranch,
    });
    if (!fetched.success) return err(fetched.error);
  }
  // Likewise a branch picked from a remote: made a local branch tracking it.
  if (args.trackRemoteBranch && existingBranch) {
    const tracked = await createWorkItemTrackingBranch({
      repoPath,
      localBranch: existingBranch,
      remote: args.trackRemoteBranch,
    });
    if (!tracked.success) return err(tracked.error);
  }

  // Before anything is written: a request the user can only fix by changing
  // it is refused here, in the dialog that sent it (lane-preflight.ts).
  const preflightRequest: LanePreflightRequest = existingBranch
    ? { kind: 'existing', branchName: existingBranch }
    : args.baseRef
      ? { kind: 'new', baseRef: args.baseRef }
      : { kind: 'new' };
  const preflight = await preflightWorkItemLane({ repoPath, request: preflightRequest });
  if (!preflight.success) return err(preflight.error);

  // Every creation path funnels through here, so resolving the user's
  // `defaultAgent` in the main process is what makes the setting take effect —
  // callers that omit an agent inherit it instead of pinning their own literal.
  const agentProvider = args.agentProvider ?? (await appSettingsService.get('defaultAgent'));

  // The account this row belongs to (schema-work-items.ts owner_account_id):
  // sync acts for it alone. Null while signed out — attributed by the first
  // account that reconciles it.
  const { user } = await chordAccountService.getSession();
  const ownerAccountId = user?.userId ?? null;

  // The work item row and its primary `work_item_worktrees` row are written
  // together, so "every work item has exactly one primary" holds from the
  // first instant. Until provisioning lands the primary points at the repo
  // root, exactly like the work item's own repoPath; provision_status
  // 'provisioning' keeps agents from running there. runWorkItemProvisioning
  // moves both to the new checkout in one transaction.
  const primaryWorktreeId = randomUUID();
  db.transaction((tx) => {
    tx.insert(workItems)
      .values({
        id,
        name: args.name,
        repoId,
        repoPath,
        repoAlias,
        branchName,
        status: args.status ?? 'active',
        provisionStatus: 'provisioning',
        agentProvider,
        ownerAccountId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.insert(workItemWorktrees)
      .values({
        id: primaryWorktreeId,
        workItemId: id,
        path: repoPath,
        branchName,
        // What was asked for, so a Retry repeats the same request. The
        // resolved fork point and PR target land in `fork_sha`/`target_ref`.
        baseBranch: args.baseRef ?? null,
        branchOrigin: existingBranch ? 'user' : 'chord',
        // Pending from the first instant: an agent's first turn waits on it
        // through provisioning and setup alike (worktrees/lane-readiness.ts).
        setupStatus: 'pending',
        isPrimary: 1,
        title: null,
        createdAt: now,
      })
      .run();

    if (args.ticket) {
      tx.insert(workItemTickets)
        .values({
          id: randomUUID(),
          workItemId: id,
          ticketId: args.ticket.id.trim(),
          ticketUrl: args.ticket.url,
          ticketProvider: args.ticket.provider,
          ticketTitle: args.ticket.title,
          createdAt: now,
        })
        .run();
    }
  });

  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);

  // Cloud create is enqueued by runWorkItemProvisioning on success — teammates
  // never see an item whose workspace may still fail to exist.
  void runWorkItemProvisioning(id, { allowLocalCopy: false, resumeInterrupted: false });

  return ok({ item: row });
}

/**
 * Re-runs the background provisioning for a 'failed' item: the banner's Retry,
 * or "Create from local copy" (`allowLocalCopy`) after a base fetch failed.
 */
export async function retryWorkItemProvisioning(
  id: string,
  options: RetryProvisionOptions = {}
): Promise<Result<void, RetryProvisionError>> {
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  if (!row) return err({ type: 'not_found' as const });
  if (row.provisionStatus !== 'failed') {
    return err({ type: 'not_failed' as const, status: row.provisionStatus });
  }
  // Read before the error is cleared below: it decides whether a checkout an
  // interrupted create left behind is this item's (devstation-dq2).
  const { resumeInterrupted } = planProvisionRetry(row);

  await db
    .update(workItems)
    .set({ provisionStatus: 'provisioning', provisionError: null, updatedAt: nowSeconds() })
    .where(eq(workItems.id, id));
  events.emit(workItemProvisionChangedChannel, { workItemId: id, provisionStatus: 'provisioning' });

  void runWorkItemProvisioning(id, {
    allowLocalCopy: options.allowLocalCopy ?? false,
    resumeInterrupted,
  });
  return ok();
}

export async function updateWorkItem(args: UpdateWorkItemArgs): Promise<{ item: WorkItemRow }> {
  const updates: Record<string, unknown> = { updatedAt: nowSeconds() };
  if (args.name !== undefined) updates.name = args.name;
  if (args.status !== undefined) updates.status = args.status;
  if (args.agentProvider !== undefined) updates.agentProvider = args.agentProvider;
  if (args.effort !== undefined) updates.effort = args.effort;
  if (args.model !== undefined) updates.model = args.model;
  if (args.branchName !== undefined) updates.branchName = args.branchName;
  if (args.prNumber !== undefined) updates.prNumber = args.prNumber;
  if (args.prUrl !== undefined) updates.prUrl = args.prUrl;

  await db.update(workItems).set(updates).where(eq(workItems.id, args.id));

  const [updated] = await db.select().from(workItems).where(eq(workItems.id, args.id)).limit(1);

  // Wire-shape at the enqueue boundary — see cloud-work-items-client. An item
  // still provisioning has no cloud row to patch; the create enqueued when
  // provisioning lands reads the row fresh, so this edit reaches the cloud
  // through that create instead.
  if (updated?.provisionStatus === 'ready') {
    syncQueueService.enqueueUpdate(
      args.id,
      toCloudWorkItemPatchBody({
        name: args.name,
        status: args.status,
        branchName: args.branchName,
        prNumber: args.prNumber,
        prUrl: args.prUrl,
      })
    );
  }

  // Save events kick git-state capture so shared-item metadata edits (e.g.
  // a branch change) surface ahead of the next interval.
  gitStateCaptureService.kick();

  return { item: updated };
}

/**
 * Deleting a work item releases its checkpoint refs first: the rows naming them
 * are the only record of which refs belong to it, so dropping the rows before
 * the refs strands the snapshot commits in the repo forever.
 *
 * A checkout that is no longer on disk holds no refs to release, and is the one
 * case where the work item is removed without touching git.
 */
export async function deleteWorkItem(id: string): Promise<Result<void, DeleteWorkItemError>> {
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);

  if (row) {
    const solo = await releaseWorkItemSoloForRemoval(id);
    if (!solo.success) return solo;
    try {
      if (await repoIsOnDisk(row.repoPath)) {
        await deleteWorkItemCheckpoints(id, row.repoPath);
        const laneIds = db
          .select({ id: workItemWorktrees.id })
          .from(workItemWorktrees)
          .where(eq(workItemWorktrees.workItemId, id))
          .all()
          .map((lane) => lane.id);
        await releaseArchiveRefs(row.repoPath, laneIds);
      } else {
        log.warn('[work-items] repo gone from disk; deleting without releasing checkpoint refs', {
          workItemId: id,
          repoPath: row.repoPath,
        });
      }
    } catch (error) {
      return err({ type: 'checkpoint_cleanup_failed' as const, message: String(error) });
    }

    // After the checkpoint refs are released, never before — the refs live in
    // the worktree's repo and releasing them needs the checkout still present.
    //
    // A failure here must not block the deletion the user asked for: the row is
    // already past the point of no return, and a leftover worktree directory is
    // recoverable with `git worktree prune`. Work items created before
    // worktrees shipped hold the repo root here and are skipped by
    // `removeWorkItemWorktree` itself.
    //
    // Every worktree row is released, including already-archived ones — their
    // checkout is already gone, so `removeWorkItemWorktree` no-ops for them —
    // and the primary is released last so a mid-loop failure leaves the
    // work item's own `repoPath` checkout intact as long as possible. An
    // adopted checkout is the user's and stays (`removeLaneCheckout`); its
    // rows and checkpoint refs go like any other.
    // Its sessions first: a terminal still open in a checkout keeps it from
    // being removed on Windows, and the folder would outlive the item.
    await stopWorkItemSessions(id);

    const worktreeRows = await db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.workItemId, id));
    const nonPrimaryFirst = [...worktreeRows].sort((a, b) => a.isPrimary - b.isPrimary);
    // A lane whose checkout was never created still holds the repository's
    // path (see createWorkItem). That folder is the user's, and it can itself
    // be a linked worktree — so no registered repository is ever removed here.
    const registeredRepos = new Set(
      (await db.select({ path: repos.path }).from(repos)).map((repo) => comparablePath(repo.path))
    );

    for (const worktreeRow of nonPrimaryFirst) {
      if (registeredRepos.has(comparablePath(worktreeRow.path))) continue;
      try {
        // Before removing the checkout: on Windows, `git worktree remove`
        // fails while a lifecycle terminal or any other process still has
        // its cwd inside the checkout, which is exactly what an acquired
        // workspace holds open.
        cancelLaneWaiters(worktreeRow.id, 'work item deleted');
        await releaseWorktreeWorkspace(worktreeRow.id);
        await removeLaneCheckout(worktreeRow);
      } catch (error) {
        log.warn('[work-items] could not remove worktree; deleting the work item anyway', {
          workItemId: id,
          worktreeId: worktreeRow.id,
          path: worktreeRow.path,
          error: String(error),
        });
      }
    }
  }

  await db.delete(workItems).where(eq(workItems.id, id));
  syncQueueService.enqueueDelete(id, row?.ownerAccountId ?? null);
  return ok();
}
