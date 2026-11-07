import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { safePathSegment } from '@shared/path-name';
import { err, ok, type Result } from '@shared/result';
import type { LaneProvisionError } from '@shared/work-item-provision-error';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { findBranchCheckout } from '@main/core/projects/worktrees/find-branch-checkout';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import {
  companionBranchFor,
  deleteCompanionBranch,
  provisionCompanionCheckout,
  removeCompanionCheckout,
  type CompanionCheckout,
  type CompanionCheckoutError,
  type CompanionRepo,
} from './companion-checkout';

/**
 * Where a lane's checkout goes, decided before git creates it: `<pool>/<slug>`,
 * or, for a repository with a companion (`companion-checkout.ts`), nested in
 * the companion's own worktree at `<pool>/<slug>/<appFolder>`, which is made
 * here first. Settings- and database-free, like `lane-checkout.ts`.
 */

export interface LanePlacement {
  /** Names the lane's folder in the pool: its checkout's, or its companion's. */
  slug: string;
  /** Where the lane's own checkout goes. */
  checkoutPath: string;
  companion: (CompanionCheckout & { repoPath: string; appFolder: string }) | null;
  /** The companion half belongs to this create: a failed lane checkout removes it. */
  removeOnFailure: boolean;
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

export function companionProvisionError(error: CompanionCheckoutError): LaneProvisionError {
  return { type: 'worktree_failed', message: `Companion repository: ${error.message}` };
}

/** Windows paths are case-insensitive, and a temp folder can be spelled two ways. */
function comparableRealPath(folder: string): string {
  const real = realpathSync.native(folder);
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

async function findCheckoutAfterPrune(repoPath: string, branch: string) {
  const ctx = new LocalExecutionContext({ root: repoPath });
  // A registration whose folder was deleted outside git is not a checkout.
  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'prune']);
  return findBranchCheckout(ctx, branch);
}

function pairedPlacement(
  companion: CompanionRepo,
  companionPath: string,
  laneBranch: string,
  branchCreated: boolean
): LanePlacement {
  const appPath = path.join(companionPath, companion.appFolder);
  return {
    slug: path.basename(companionPath),
    checkoutPath: appPath,
    companion: {
      companionPath,
      companionBranch: companionBranchFor(laneBranch),
      appPath,
      branchCreated,
      repoPath: companion.path,
      appFolder: companion.appFolder,
    },
    removeOnFailure: true,
  };
}

/**
 * devstation-dq2, and its companion half: what an interrupted create of
 * `branchName` left in this pool. Chord died after `worktree add` ran but
 * before the row moved to it, so nothing else points there. `exists` says the
 * lane's own checkout is there (else only its companion half was made). Returns
 * `branch_checked_out` for the branch checked out anywhere else — that
 * checkout is not this item's to take over.
 */
export async function findInterruptedPlacement(args: {
  repoPath: string;
  poolPath: string;
  branchName: string;
  companion?: CompanionRepo;
}): Promise<Result<(LanePlacement & { exists: boolean }) | undefined, LaneProvisionError>> {
  const holder = await findCheckoutAfterPrune(args.repoPath, args.branchName);
  const pool = comparableRealPath(args.poolPath);
  if (!args.companion) {
    if (!holder) return ok(undefined);
    if (comparableRealPath(path.dirname(holder)) !== pool) {
      return err(branchCheckedOutError(args.branchName, holder));
    }
    const slug = path.basename(holder);
    return ok({
      slug,
      checkoutPath: holder,
      companion: null,
      removeOnFailure: false,
      exists: true,
    });
  }

  const companionHolder = await findCheckoutAfterPrune(
    args.companion.path,
    companionBranchFor(args.branchName)
  );
  const ownCompanion =
    companionHolder !== undefined && comparableRealPath(path.dirname(companionHolder)) === pool
      ? pairedPlacement(args.companion, companionHolder, args.branchName, false)
      : undefined;
  if (holder) {
    if (
      !ownCompanion ||
      comparableRealPath(holder) !== comparableRealPath(ownCompanion.checkoutPath)
    ) {
      return err(branchCheckedOutError(args.branchName, holder));
    }
    return ok({ ...ownCompanion, exists: true });
  }
  return ok(ownCompanion ? { ...ownCompanion, exists: false } : undefined);
}

/** A new placement: a free slug, and the companion's worktree there when there is one. */
export async function placeLaneCheckout(args: {
  poolPath: string;
  branchName: string;
  companion?: CompanionRepo;
}): Promise<Result<LanePlacement, LaneProvisionError>> {
  const slug = allocateSlug(args.poolPath, args.branchName);
  if (!args.companion) {
    return ok({
      slug,
      checkoutPath: path.join(args.poolPath, slug),
      companion: null,
      removeOnFailure: false,
    });
  }
  const made = await provisionCompanionCheckout({
    companion: args.companion,
    poolPath: args.poolPath,
    slug,
    laneBranch: args.branchName,
  });
  if (!made.success) return err(companionProvisionError(made.error));
  return ok(
    pairedPlacement(
      args.companion,
      made.data.companionPath,
      args.branchName,
      made.data.branchCreated
    )
  );
}

/**
 * Undoes this create's companion half after its lane checkout failed, so the
 * failure leaves nothing. The refusal is returned with what removing failed on.
 */
export async function releaseFailedPlacement(
  placement: LanePlacement,
  refusal: LaneProvisionError
): Promise<LaneProvisionError> {
  if (!placement.companion || !placement.removeOnFailure) return refusal;
  const removed = await removeCompanionCheckout({
    companion: { path: placement.companion.repoPath, appFolder: placement.companion.appFolder },
    companionPath: placement.companion.companionPath,
  });
  if (removed.success) {
    if (placement.companion.branchCreated) {
      await deleteCompanionBranch(
        placement.companion.repoPath,
        placement.companion.companionBranch
      );
    }
    return refusal;
  }
  return {
    type: 'worktree_failed',
    message: `${refusal.message} The companion checkout at ${placement.companion.companionPath} was kept: ${removed.error.message}`,
  };
}
