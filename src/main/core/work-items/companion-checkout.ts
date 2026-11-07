import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import z from 'zod';
import { err, ok, type Result } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { findBranchCheckout } from '@main/core/projects/worktrees/find-branch-checkout';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * A companion repository wraps a repository's checkouts: the repository sits
 * at `appFolder` inside it (a private workspace of tools and notes around a
 * public app, say), and the companion ignores that folder. A lane of such a
 * repository gets the pair: the companion's own linked worktree at
 * `<pool>/<slug>` on `companion/<lane branch>`, forked from the commit the
 * companion's main checkout is on, and the lane's checkout nested at
 * `<pool>/<slug>/<appFolder>`, so whatever starts at the companion's root
 * sees both, as it does in the main checkouts.
 *
 * The companion branch outlives its worktree, as a lane's branch does: a lane
 * restored, or a later lane of the same branch, checks it out again.
 *
 * The git half only: settings- and database-free like `lane-checkout.ts`, so
 * it is tested against real repositories without an Electron runtime.
 */

const BRANCH_PREFIX = 'companion';

/** The companion branch that pairs with a lane on `laneBranch`. */
export function companionBranchFor(laneBranch: string): string {
  return `${BRANCH_PREFIX}/${laneBranch}`;
}

function isFolderInside(value: string): boolean {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  return value.split(/[\\/]+/).every((segment) => segment !== '..' && segment !== '');
}

export const companionRepoSchema = z
  .object({
    /** The companion's main checkout. */
    path: z
      .string()
      .trim()
      .refine((value) => path.isAbsolute(value), 'must be an absolute path'),
    /** Where the repository sits inside the companion, e.g. `app`. */
    appFolder: z
      .string()
      .trim()
      .refine(isFolderInside, 'must be a folder inside the companion, without ..'),
  })
  .strict();

export type CompanionRepo = z.infer<typeof companionRepoSchema>;

export type CompanionCheckoutError =
  | { type: 'not_a_main_checkout'; message: string }
  | { type: 'detached_head'; message: string }
  | { type: 'app_folder_not_ignored'; message: string }
  | { type: 'branch_checked_out'; branch: string; path: string; message: string }
  | { type: 'path_exists'; path: string; message: string }
  | { type: 'lane_checkout_present'; path: string; message: string }
  | { type: 'companion_has_changes'; path: string; message: string }
  | { type: 'git_failed'; message: string };

export interface CompanionCheckout {
  /** The companion's linked worktree: where a session that needs both starts. */
  companionPath: string;
  companionBranch: string;
  /** Where the lane's own checkout goes. Not created here. */
  appPath: string;
  /** This call made the branch, rather than checking out one an earlier lane left. */
  branchCreated: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/**
 * Every path `git status` reports in a checkout, ignored ones included. Read as `-z` and
 * untrimmed: each entry is `XY <path>`, where X can be a space, so trimming the output cut the
 * first path's first character; a rename or copy carries its source path as the next entry.
 */
async function statusPaths(cwd: string): Promise<string[]> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, [
    'status',
    '--porcelain=v1',
    '-z',
    '--ignored',
  ]);
  const entries = stdout.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
  }
  return paths;
}

/** The exit code of a git command that answers yes (0) or no (1); anything else throws. */
async function gitAnswers(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

function gitFailed(what: string, error: unknown): CompanionCheckoutError {
  return { type: 'git_failed', message: `${what} failed: ${String(error)}` };
}

function isMainCheckout(folder: string): boolean {
  const dotGit = path.join(folder, '.git');
  return existsSync(dotGit) && statSync(dotGit).isDirectory();
}

/**
 * Creates the companion half of a lane's pair: a new companion branch at the
 * commit the companion's main checkout is on, or the companion branch an
 * earlier lane of this branch left, as it is. Refuses, creating nothing, when
 * the companion is not a main checkout, is on no branch, does not ignore
 * `appFolder` (the lane's checkout would show as untracked files in it), when
 * the folder is taken, or when the branch is checked out somewhere else.
 */
export async function provisionCompanionCheckout(args: {
  companion: CompanionRepo;
  poolPath: string;
  slug: string;
  laneBranch: string;
}): Promise<Result<CompanionCheckout, CompanionCheckoutError>> {
  const { companion } = args;
  if (!isMainCheckout(companion.path)) {
    return err({
      type: 'not_a_main_checkout',
      message: `${companion.path} is not the main checkout of a git repository.`,
    });
  }
  const companionPath = path.join(args.poolPath, args.slug);
  const companionBranch = companionBranchFor(args.laneBranch);
  try {
    const head = await git(companion.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (head === 'HEAD') {
      return err({
        type: 'detached_head',
        message: `${companion.path} is on no branch: lanes fork its worktree from its branch.`,
      });
    }
    const appFolder = companion.appFolder.replaceAll('\\', '/');
    if (!(await gitAnswers(companion.path, ['check-ignore', '-q', `${appFolder}/`]))) {
      return err({
        type: 'app_folder_not_ignored',
        message: `${companion.path} does not ignore ${appFolder}/, so a lane's checkout there would show as untracked files.`,
      });
    }
    if (existsSync(companionPath)) {
      return err({
        type: 'path_exists',
        path: companionPath,
        message: `${companionPath} already exists.`,
      });
    }
    const ctx = new LocalExecutionContext({ root: companion.path });
    // A registration whose folder was deleted outside git is not a checkout.
    await git(companion.path, ['worktree', 'prune']);
    const holder = await findBranchCheckout(ctx, companionBranch);
    if (holder) {
      return err({
        type: 'branch_checked_out',
        branch: companionBranch,
        path: holder,
        message: `The companion's branch ${companionBranch} is checked out in ${holder}.`,
      });
    }
    const branchExists = await gitAnswers(companion.path, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${companionBranch}`,
    ]);
    if (branchExists) {
      await git(companion.path, ['worktree', 'add', companionPath, companionBranch]);
    } else {
      const startPoint = await git(companion.path, ['rev-parse', 'HEAD']);
      await git(companion.path, [
        'worktree',
        'add',
        '-b',
        companionBranch,
        companionPath,
        startPoint,
      ]);
    }
    return ok({
      companionPath,
      companionBranch,
      appPath: path.join(companionPath, companion.appFolder),
      branchCreated: !branchExists,
    });
  } catch (error) {
    return err(gitFailed('Creating the companion checkout', error));
  }
}

/**
 * Refuses a companion checkout holding anything a removal would lose: changes,
 * untracked files, and ignored ones too, because `git worktree remove` deletes
 * ignored files with the folder, and a companion's ignored files (local state,
 * .env) are the user's, not the lane's. The lane's own folder does not count.
 * Lane removals run it before they remove anything (`removeLaneCheckout`).
 */
export async function checkCompanionRemovable(args: {
  companion: CompanionRepo;
  companionPath: string;
}): Promise<Result<void, CompanionCheckoutError>> {
  try {
    const appPrefix = `${args.companion.appFolder.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
    const leftovers = (await statusPaths(args.companionPath)).filter(
      (file) => !file.startsWith(appPrefix)
    );
    if (leftovers.length === 0) return ok();
    return err({
      type: 'companion_has_changes',
      path: args.companionPath,
      message: `${args.companionPath} holds changes or ignored files nothing else keeps (${leftovers
        .slice(0, 3)
        .join(', ')}); move, commit or discard them first.`,
    });
  } catch (error) {
    return err(gitFailed('Reading the companion checkout', error));
  }
}

/**
 * Removes the companion half after the lane's own checkout is gone. Its branch
 * stays, as a lane's does. Refuses while the lane's checkout is still nested in
 * it (removing the folder would take it along) and while the companion
 * checkout holds anything (`checkCompanionRemovable`).
 */
export async function removeCompanionCheckout(args: {
  companion: CompanionRepo;
  companionPath: string;
}): Promise<Result<void, CompanionCheckoutError>> {
  const appPath = path.join(args.companionPath, args.companion.appFolder);
  if (existsSync(appPath)) {
    return err({
      type: 'lane_checkout_present',
      path: appPath,
      message: `The lane's checkout is still at ${appPath}: remove it first.`,
    });
  }
  const removable = await checkCompanionRemovable(args);
  if (!removable.success) return removable;
  try {
    await git(args.companion.path, ['worktree', 'remove', args.companionPath]);
    return ok();
  } catch (error) {
    return err(gitFailed('Removing the companion checkout', error));
  }
}

/** Deletes a companion branch a failed create made; one an earlier lane left is never passed. */
export async function deleteCompanionBranch(companionRepoPath: string, branch: string) {
  await git(companionRepoPath, ['branch', '-D', branch]);
}
