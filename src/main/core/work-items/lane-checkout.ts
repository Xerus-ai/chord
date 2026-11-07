import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import type { ForkSource } from '@shared/worktrees';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalWorktreeHost } from '@main/core/projects/worktrees/hosts/local-worktree-host';
import {
  WorktreeService,
  type WorktreeCheckoutError,
} from '@main/core/projects/worktrees/worktree-service';
import { resolveDefaultBaseRef, resolveLaneBase } from '@main/core/repo-config/resolve-lane-base';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { CompanionRepo } from './companion-checkout';
import {
  branchCheckedOutError,
  findInterruptedPlacement,
  placeLaneCheckout,
  releaseFailedPlacement,
  type LanePlacement,
} from './lane-checkout-placement';


/**
 * The git half of creating a lane: resolve where it forks from, create the
 * branch and its checkout at `<pool>/<slug>`, or nested in its companion's
 * worktree (`lane-checkout-placement.ts`). Nothing config-driven happens here
 * (files to copy, setup scripts — see `worktrees/lane-setup.ts`), so a
 * failure leaves nothing behind: the branch and checkout are created by one
 * `worktree add`, which the engine undoes itself when it fails, and a
 * companion half made for it is removed again.
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
  /** The companion worktree the checkout is nested in, and the companion's main checkout. */
  companionPath: string | null;
  companionRepoPath: string | null;
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

async function revParse(repoPath: string, ref: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: repoPath }).exec(GIT_EXECUTABLE, [
    'rev-parse',
    `${ref}^{commit}`,
  ]);
  return stdout.trim();
}

/** Creates the lane's branch checkout at the placement's folder; undoes the placement on failure. */
async function checkoutAt(
  args: { repoPath: string; poolPath: string },
  placement: LanePlacement,
  checkout:
    | { kind: 'existing'; branchName: string }
    | { kind: 'new'; branchName: string; startPoint: string }
): Promise<Result<string, LaneProvisionError>> {
  const host = await LocalWorktreeHost.create({ allowedRoots: [args.repoPath, args.poolPath] });
  const service = new WorktreeService({
    worktreePoolPath: path.dirname(placement.checkoutPath),
    repoPath: args.repoPath,
    ctx: new LocalExecutionContext({ root: args.repoPath }),
    host,
  });
  const slug = path.basename(placement.checkoutPath);
  const made =
    checkout.kind === 'existing'
      ? await service.checkoutExistingBranch({ branchName: checkout.branchName, slug })
      : await service.checkoutNewBranch({
          branchName: checkout.branchName,
          slug,
          startPoint: checkout.startPoint,
        });
  if (made.success) return ok(made.data);
  return err(await releaseFailedPlacement(placement, describeCheckoutError(made.error)));
}

function companionFields(placement: LanePlacement) {
  return {
    companionPath: placement.companion?.companionPath ?? null,
    companionRepoPath: placement.companion?.repoPath ?? null,
  };
}

export async function provisionLaneCheckout(args: {
  /** The repository's main checkout. */
  repoPath: string;
  /** This repository's folder under the worktree root. */
  poolPath: string;
  request: LaneCheckoutRequest;
  /** The repository's companion (this machine's setting): the checkout nests in its worktree. */
  companion?: CompanionRepo;
  /** Runs fetches; pass one carrying GitHub auth. */
  networkContext?: IExecutionContext;
  /** The user chose to fork from the base's last-fetched copy if its fetch fails. */
  allowLocalCopy?: boolean;
  /**
   * Retry of an `interrupted` create: a checkout of this new branch directly in
   * the pool (or in its companion's worktree there) is the one that create
   * made, and is used as it is.
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
  const place = () =>
    placeLaneCheckout({
      poolPath: args.poolPath,
      branchName: request.branchName,
      companion: args.companion,
    });

  if (request.kind === 'existing') {
    // Where its PR would merge: the repository's default base, as this clone
    // recorded it. Nothing forks from it, so it needs no fetch — and a branch
    // the clone already has checks out offline.
    const targetRef = await resolveDefaultBaseRef(args.repoPath, args.networkContext);
    if (!targetRef.success) return err(targetRef.error);
    const placement = await place();
    if (!placement.success) return placement;
    const checkout = await checkoutAt(args, placement.data, request);
    if (!checkout.success) return checkout;
    return ok({
      worktreePath: checkout.data,
      branchName: request.branchName,
      slug: placement.data.slug,
      targetRef: targetRef.data,
      forkSha: await revParse(args.repoPath, request.branchName),
      branchOrigin: 'user',
      forkSource: null,
      ...companionFields(placement.data),
    });
  }

  let targetRef: string;
  let forkSha: string;
  let forkSource: ForkSource;
  let placement: LanePlacement | undefined;
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
      const interrupted = await findInterruptedPlacement({
        repoPath: args.repoPath,
        poolPath: args.poolPath,
        branchName: request.branchName,
        companion: args.companion,
      });
      if (!interrupted.success) return err(interrupted.error);
      if (interrupted.data?.exists) {
        // Nothing ran in it while Chord was down, so its tip is the commit the
        // interrupted create forked from. `forkSource` is how this Retry
        // obtained the base.
        return ok({
          worktreePath: interrupted.data.checkoutPath,
          branchName: request.branchName,
          slug: interrupted.data.slug,
          targetRef,
          forkSha: await revParse(args.repoPath, request.branchName),
          branchOrigin: 'chord',
          forkSource,
          ...companionFields(interrupted.data),
        });
      }
      // Only its companion half was made: the checkout goes there.
      placement = interrupted.data;
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

  if (!placement) {
    const placed = await place();
    if (!placed.success) return placed;
    placement = placed.data;
  }
  const checkout = await checkoutAt(args, placement, {
    kind: 'new',
    branchName: request.branchName,
    startPoint: forkSha,
  });
  if (!checkout.success) return checkout;
  return ok({
    worktreePath: checkout.data,
    branchName: request.branchName,
    slug: placement.slug,
    targetRef,
    forkSha,
    branchOrigin: 'chord',
    forkSource,
    ...companionFields(placement),
  });
}
