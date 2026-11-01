import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import {
  buildWorktreeBranchName,
  type ForkSource,
  type Worktree,
  type WorktreeArchiveInspection,
} from '@shared/worktrees';
import { restoreCheckpointCommit } from '@main/core/checkpoints/checkpoint-git';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { readLanePr } from '@main/core/pull-requests/lane-pull-requests';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { updateWorkItem } from '@main/core/work-items/work-item-crud';
import { provisionWorkItemWorktree } from '@main/core/work-items/work-item-worktree';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { canDeleteLaneBranch } from './archive-branch-delete';
import { inspectWorktreeGitState } from './archive-inspect';
import {
  planWorktreePromotion,
  type PromoteWorktreeError as PromoteDecisionError,
} from './decisions';
import { runLaneSetup } from './lane-setup';
import { resolveMainRepoPathForWorkItem } from './repo-path';
import { acquireWorktreeWorkspace } from './workspace-bridge';
import { scheduleWorktreeCloudSync } from './worktree-cloud-sync';
import { findWorktreeRow, getPrimaryWorktreeRow } from './worktree-lookup';

/**
 * DB + git orchestration for a work item's non-primary worktrees. The pure
 * refusal rules live in `decisions.ts` (unit-testable without the database);
 * the pure git inspection lives in `archive-inspect.ts`. This module is the
 * layer that reads/writes `work_item_worktrees` and calls out to both.
 */

export type CreateWorktreeError =
  | { type: 'work_item_not_found' }
  | { type: 'no_source_branch' }
  | LaneProvisionError;

export type SetWorktreeTitleError = { type: 'not_found' };

export type InspectWorktreeArchiveError = { type: 'not_found' };

export type PromoteWorktreeError = { type: 'not_found' } | PromoteDecisionError;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toSetupStatus(value: string | null): Worktree['setupStatus'] {
  if (value === null) return null;
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'ok' ||
    value === 'failed' ||
    value === 'skipped'
  ) {
    return value;
  }
  throw new Error(`Unknown work_item_worktrees.setup_status "${value}"`);
}

function toForkSource(value: string | null): ForkSource | null {
  if (value === null) return null;
  if (value === 'fetched' || value === 'local_copy' || value === 'local') return value;
  throw new Error(`Unknown work_item_worktrees.fork_source "${value}"`);
}

function toCheckoutOrigin(value: string): Worktree['checkoutOrigin'] {
  if (value === 'chord' || value === 'adopted') return value;
  throw new Error(`Unknown work_item_worktrees.checkout_origin "${value}"`);
}

export function toWorktreeDto(row: WorkItemWorktreeRow): Worktree {
  return {
    id: row.id,
    workItemId: row.workItemId,
    path: row.path,
    branchName: row.branchName,
    baseBranch: row.baseBranch,
    targetRef: row.targetRef,
    setupStatus: toSetupStatus(row.setupStatus),
    forkSource: toForkSource(row.forkSource),
    checkoutOrigin: toCheckoutOrigin(row.checkoutOrigin),
    isPrimary: row.isPrimary === 1,
    title: row.title,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

/** Primary first, then oldest to newest — the order the sidebar shows sub-rows in. */
export async function listWorktrees(
  workItemId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<Worktree[]> {
  const rows = await db
    .select()
    .from(workItemWorktrees)
    .where(eq(workItemWorktrees.workItemId, workItemId));
  const visible = opts.includeArchived ? rows : rows.filter((row) => row.archivedAt === null);
  visible.sort((a, b) => b.isPrimary - a.isPrimary || a.createdAt - b.createdAt);
  return visible.map(toWorktreeDto);
}

async function resolveCurrentBranch(repoPath: string): Promise<string | undefined> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = stdout.trim();
  if (!branch || branch === 'HEAD') return undefined;
  return branch;
}

async function listLocalBranches(repoPath: string): Promise<string[]> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
  ]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The commit a checkpoint was taken on: the lane's HEAD at that turn. */
async function resolveCheckpointParent(repoPath: string, checkpointSha: string): Promise<string> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', `${checkpointSha}^`]);
  return stdout.trim();
}

/**
 * Creates a secondary worktree forked from the work item's own branch (or an
 * explicit `baseBranch`). The branch name is `<work-item-branch>--<slug>`
 * (or `--2`, `--3`, ... without a title) via `buildWorktreeBranchName`.
 *
 * `fromCheckpoint` (Fork to new worktree) forks from that checkpoint's parent
 * instead, and writes the checkpoint's files over the new checkout
 * uncommitted before its setup runs.
 */
export async function createWorktree(args: {
  workItemId: string;
  title?: string;
  baseBranch?: string;
  fromCheckpoint?: string;
}): Promise<Result<Worktree, CreateWorktreeError>> {
  const [workItem] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, args.workItemId))
    .limit(1);
  if (!workItem) return err({ type: 'work_item_not_found' as const });

  const primary = getPrimaryWorktreeRow(args.workItemId);
  const mainRepoPath = await resolveMainRepoPathForWorkItem(workItem, primary);

  // The name always derives from the work item's branch; only the fork point
  // follows an explicit `baseBranch`. Pre-worktree items have no stored
  // branch, so their primary checkout's current branch stands in for it.
  const workItemBranch = primary.branchName ?? (await resolveCurrentBranch(primary.path));
  if (!workItemBranch) return err({ type: 'no_source_branch' as const });
  const sourceBranch = args.baseBranch ?? workItemBranch;

  const existingBranches = await listLocalBranches(mainRepoPath);
  const branchName = buildWorktreeBranchName(workItemBranch, args.title, existingBranches);

  // A secondary lane merges where the work item does, unless it was
  // explicitly based elsewhere — then the default base is its PR target.
  const provisioned = await provisionWorkItemWorktree({
    repoPath: mainRepoPath,
    repoLabel: workItem.repoAlias ?? mainRepoPath,
    repoId: workItem.repoId,
    request: {
      kind: 'fork',
      branchName,
      startRef: args.fromCheckpoint
        ? await resolveCheckpointParent(mainRepoPath, args.fromCheckpoint)
        : sourceBranch,
      targetRef: args.baseBranch ? null : primary.targetRef,
    },
    // It forks from the work item's own branch in this clone: nothing to fetch.
    allowLocalCopy: false,
    // A new secondary lane, never a Retry.
    resumeInterrupted: false,
  });
  if (!provisioned.success) return err(provisioned.error);
  const lane = provisioned.data;
  if (args.fromCheckpoint) await restoreCheckpointCommit(lane.worktreePath, args.fromCheckpoint);

  const id = randomUUID();
  await db.insert(workItemWorktrees).values({
    id,
    workItemId: args.workItemId,
    path: lane.worktreePath,
    branchName: lane.branchName,
    baseBranch: sourceBranch,
    targetRef: lane.targetRef,
    forkSha: lane.forkSha,
    slug: lane.slug,
    branchOrigin: lane.branchOrigin,
    forkSource: lane.forkSource,
    setupStatus: 'pending',
    isPrimary: 0,
    title: args.title ?? null,
    createdAt: nowSeconds(),
  });

  const row = findWorktreeRow(id);
  if (!row) throw new Error(`Inserted worktree ${id} but could not read it back`);
  log.info('[worktrees] created secondary worktree', {
    workItemId: args.workItemId,
    worktreeId: id,
    branchName: provisioned.data.branchName,
  });

  // A failure here leaves a usable worktree with no backend for its panels
  // yet; it is not worth failing the creation the user asked for, and boot
  // acquisition on the next launch retries it.
  try {
    await acquireWorktreeWorkspace(row);
  } catch (error) {
    log.warn('[worktrees] could not acquire workspace for new secondary worktree', {
      workItemId: args.workItemId,
      worktreeId: id,
      error: String(error),
    });
  }

  // Records its own outcome (setup_status + log) and never rejects.
  void runLaneSetup(id, askScriptApproval);

  scheduleWorktreeCloudSync(args.workItemId);
  return ok(toWorktreeDto(row));
}

export async function setWorktreeTitle(
  worktreeId: string,
  title: string
): Promise<Result<Worktree, SetWorktreeTitleError>> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return err({ type: 'not_found' as const });

  await db.update(workItemWorktrees).set({ title }).where(eq(workItemWorktrees.id, worktreeId));

  const updated = findWorktreeRow(worktreeId);
  if (!updated) throw new Error(`Renamed worktree ${worktreeId} but could not read it back`);
  scheduleWorktreeCloudSync(updated.workItemId);
  return ok(toWorktreeDto(updated));
}

export async function inspectWorktreeArchive(
  worktreeId: string
): Promise<Result<WorktreeArchiveInspection, InspectWorktreeArchiveError>> {
  const row = findWorktreeRow(worktreeId);
  if (!row) return err({ type: 'not_found' as const });
  const state = await inspectWorktreeGitState(row.path);
  return ok({ ...state, branchDeletable: await canDeleteLaneBranch(row, state.uncommitted) });
}

/**
 * Flips `isPrimary` in one transaction — the old primary first, so the
 * partial unique index (`uq_work_item_worktrees_primary`, one `is_primary = 1`
 * row per work item) never sees two primaries at once — then rewrites
 * `work_items.repo_path` to the new primary's checkout. `branchName` and the
 * PR mirror are left to `updateWorkItem`, run right after: it also enqueues
 * the cloud PATCH and kicks git-state capture (D2 — the PR/branch context
 * follows the primary), which this function has no reason to duplicate.
 */
export async function promoteWorktreeToPrimary(
  worktreeId: string
): Promise<Result<Worktree, PromoteWorktreeError>> {
  const target = findWorktreeRow(worktreeId);
  if (!target) return err({ type: 'not_found' as const });

  const plan = planWorktreePromotion({
    isPrimary: target.isPrimary === 1,
    archivedAt: target.archivedAt,
  });
  if (!plan.success) return err(plan.error);
  if (plan.data === 'already_primary') return ok(toWorktreeDto(target));

  const currentPrimary = getPrimaryWorktreeRow(target.workItemId);

  db.transaction((tx) => {
    tx.update(workItemWorktrees)
      .set({ isPrimary: 0 })
      .where(eq(workItemWorktrees.id, currentPrimary.id))
      .run();
    tx.update(workItemWorktrees)
      .set({ isPrimary: 1 })
      .where(eq(workItemWorktrees.id, target.id))
      .run();
    tx.update(workItems)
      .set({ repoPath: target.path })
      .where(eq(workItems.id, target.workItemId))
      .run();
  });

  // `work_items.pr_*` mirrors the primary lane's PR for the cloud, so it moves
  // with the primary — cleared when the promoted lane has none (P8). Read after
  // the flip: the lookup resolves the remote from the new primary's checkout.
  const mirror = await readLanePr(target.workItemId, target.id);
  await updateWorkItem({
    id: target.workItemId,
    branchName: target.branchName ?? undefined,
    prNumber: mirror?.number ?? null,
    prUrl: mirror?.url ?? null,
  });

  const updated = findWorktreeRow(target.id);
  if (!updated) throw new Error(`Promoted worktree ${target.id} but could not read it back`);
  log.info('[worktrees] promoted worktree to primary', {
    workItemId: target.workItemId,
    worktreeId: target.id,
    previousPrimaryId: currentPrimary.id,
  });
  scheduleWorktreeCloudSync(target.workItemId);
  return ok(toWorktreeDto(updated));
}
