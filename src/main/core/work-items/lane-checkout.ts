import { existsSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { safePathSegment } from '@shared/path-name';
import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import type { ForkSource } from '@shared/worktrees';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { findBranchCheckout } from '@main/core/projects/worktrees/find-branch-checkout';
import { LocalWorktreeHost } from '@main/core/projects/worktrees/hosts/local-worktree-host';
import {
  WorktreeService,
  type WorktreeCheckoutError,
} from '@main/core/projects/worktrees/worktree-service';
import { resolveDefaultBaseRef, resolveLaneBase } from '@main/core/repo-config/resolve-lane-base';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * The git half of creating a lane: resolve where it forks from, create the
 * branch and its checkout at `<pool>/<slug>`. Nothing config-driven happens
 * here (files to copy, setup scripts — see `worktrees/lane-setup.ts`), so a
 * failure leaves nothing behind: the branch and checkout are created by one
 * `worktree add`, which the engine undoes itself when it fails.
 *
 * Deliberately settings- and database-free, so it is tested against real
 * repositories without an Electron runtime.
 */

export type LaneCheckoutRequest =
  /** A new chord-named branch, forked from the resolved base. */
  | { kind: 'new'; branchName: string; baseRef?: string; justMeBaseBranch?: string }
  /** A branch that already exists, checked out as-is. */
  | { kind: 'existing'; branchName: string }
  /** A secondary lane off the work item's own branch, merging where the item does. */
  | { kind: 'fork'; branchName: string; startRef: string; targetRef: string | null };

export interface ProvisionedLane {
  worktreePath: string;
  branchName: string;
  slug: string;
  targetRef: string;
  forkSha: string;
  branchOrigin: 'chord' | 'user';
  /** Null for a checkout of an existing branch, which forks from nothing. */
  forkSource: ForkSource | null;
}

/** The branch's last segment, made safe as a directory name, and unique in the pool. */
export function allocateSlug(poolPath: string, branchName: string): string {
  const leaf = branchName.split('/').filter(Boolean).pop() ?? branchName;
  const base = safePathSegment(leaf, 'lane');
  let slug = base;
  for (let n = 2; existsSync(path.join(poolPath, slug)); n += 1) slug = `${base}-${n}`;
  return slug;
}

/** The refusal a lane gets for a branch checked out somewhere — shared with the preflight. */
export function branchCheckedOutError(
  branch: string,
  holder: string
): Extract<LaneProvisionError, { type: 'branch_checked_out' }> {
  return {
    type: 'branch_checked_out',
    branch,
    path: holder,
    message: `${branch} is already checked out in ${holder}. A lane needs a branch of its own — branch off it instead, or switch that checkout to another branch.`,
  };
}

/** The refusal a lane gets for a branch neither this clone nor the remote has. */
export function branchNotFoundError(
  branch: string
): Extract<LaneProvisionError, { type: 'branch_not_found' }> {
  return {
    type: 'branch_not_found',
    branch,
    message: `Branch ${branch} was not found locally or on the remote.`,
  };
}

function describeCheckoutError(error: WorktreeCheckoutError): LaneProvisionError {
  switch (error.type) {
    case 'branch-checked-out':
      return branchCheckedOutError(error.branch, error.path);
    case 'branch-exists':
      return {
        type: 'branch_exists',
        branch: error.branch,
        message: `A branch named ${error.branch} already exists. Pick it as an existing branch, or use another name.`,
      };
    case 'branch-not-found':
      return branchNotFoundError(error.branch);
    case 'path-exists':
      return {
        type: 'worktree_failed',
        message: `${error.path} already exists and is not this lane's checkout.`,
      };
    case 'worktree-setup-failed':
      return {
        type: 'worktree_failed',
        message: `Could not create a git worktree: ${String(error.cause)}`,
      };
  }
}

/** Windows paths are case-insensitive, and a temp folder can be spelled two ways. */
function comparableRealPath(folder: string): string {
  const real = realpathSync.native(folder);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * devstation-dq2: the checkout an interrupted create left behind, if git has
 * `branchName` checked out directly in this pool. Chord died after `worktree
 * add` ran but before the row moved to it, so nothing else points there.
 * Returns `branch_checked_out` for the branch checked out anywhere else — that
 * checkout is not this item's to take over.
 */
async function findInterruptedCheckout(
  repoPath: string,
  poolPath: string,
  branchName: string
): Promise<Result<string | undefined, LaneProvisionError>> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  // A registration whose folder was deleted outside git is not a checkout.
  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'prune']);
  const holder = await findBranchCheckout(ctx, branchName);
  if (!holder) return ok(undefined);
  if (comparableRealPath(path.dirname(holder)) !== comparableRealPath(poolPath)) {
    return err(branchCheckedOutError(branchName, holder));
  }
  return ok(holder);
}

async function revParse(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: repoPath }).exec(GIT_EXECUTABLE, [
    'rev-parse',
    `${ref}^{commit}`,
  ]);
  return stdout.trim();
}

export async function provisionLaneCheckout(args: {
  /** The repository's main checkout. */
  repoPath: string;
  /** This repository's folder under the worktree root. */
  poolPath: string;
  request: LaneCheckoutRequest;
  /** Runs fetches; pass one carrying GitHub auth. */
  networkContext?: IExecutionContext;
  /** The user chose to fork from the base's last-fetched copy if its fetch fails. */
  allowLocalCopy?: boolean;
  /**
   * Retry of an `interrupted` create: a checkout of this new branch directly in
   * the pool is the one that create made, and is used as it is.
   */
  resumeInterrupted?: boolean;
}): Promise<Result<ProvisionedLane, LaneProvisionError>> {
  const { request } = args;
  try {
    await mkdir(args.poolPath, { recursive: true });
  } catch (cause) {
    return err({
      type: 'worktree_failed',
      message: `Could not create the worktree folder ${args.poolPath}: ${String(cause)}`,
    });
  }
  const host = await LocalWorktreeHost.create({ allowedRoots: [args.repoPath, args.poolPath] });
  const service = new WorktreeService({
    worktreePoolPath: args.poolPath,
    repoPath: args.repoPath,
    ctx: new LocalExecutionContext({ root: args.repoPath }),
    host,
  });
  const slug = allocateSlug(args.poolPath, request.branchName);

  if (request.kind === 'existing') {
    // Where its PR would merge: the repository's default base, as this clone
    // recorded it. Nothing forks from it, so it needs no fetch — and a branch
    // the clone already has checks out offline.
    const targetRef = await resolveDefaultBaseRef(args.repoPath, args.networkContext);
    if (!targetRef.success) return err(targetRef.error);
    const checkout = await service.checkoutExistingBranch({
      branchName: request.branchName,
      slug,
    });
    if (!checkout.success) return err(describeCheckoutError(checkout.error));
    return ok({
      worktreePath: checkout.data,
      branchName: request.branchName,
      slug,
      targetRef: targetRef.data,
      forkSha: await revParse(args.repoPath, request.branchName),
      branchOrigin: 'user',
      forkSource: null,
    });
  }

  let targetRef: string;
  let forkSha: string;
  let forkSource: ForkSource;
  if (request.kind === 'new') {
    const base = await resolveLaneBase({
      repoPath: args.repoPath,
      baseRef: request.baseRef,
      justMeBaseBranch: request.justMeBaseBranch,
      networkContext: args.networkContext,
      allowLocalCopy: args.allowLocalCopy,
    });
    if (!base.success) return err(base.error);
    ({ targetRef, forkSha, forkSource } = base.data);

    if (args.resumeInterrupted) {
      const interrupted = await findInterruptedCheckout(
        args.repoPath,
        args.poolPath,
        request.branchName
      );
      if (!interrupted.success) return err(interrupted.error);
      if (interrupted.data) {
        // Nothing ran in it while Chord was down, so its tip is the commit the
        // interrupted create forked from. `forkSource` is how this Retry
        // obtained the base.
        return ok({
          worktreePath: interrupted.data,
          branchName: request.branchName,
          slug: path.basename(interrupted.data),
          targetRef,
          forkSha: await revParse(args.repoPath, request.branchName),
          branchOrigin: 'chord',
          forkSource,
        });
      }
    }
  } else {
    // A secondary lane forks from the work item's own branch, in this clone.
    forkSha = await revParse(args.repoPath, request.startRef);
    forkSource = 'local';
    if (request.targetRef) {
      targetRef = request.targetRef;
    } else {
      const base = await resolveDefaultBaseRef(args.repoPath, args.networkContext);
      if (!base.success) return err(base.error);
      targetRef = base.data;
    }
  }

  const checkout = await service.checkoutNewBranch({
    branchName: request.branchName,
    slug,
    startPoint: forkSha,
  });
  if (!checkout.success) return err(describeCheckoutError(checkout.error));
  return ok({
    worktreePath: checkout.data,
    branchName: request.branchName,
    slug,
    targetRef,
    forkSha,
    branchOrigin: 'chord',
    forkSource,
  });
}
