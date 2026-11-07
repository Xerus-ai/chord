import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import z from 'zod';
import { err, ok, type Result } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
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
 * The git half only: settings- and database-free like `lane-checkout.ts`, so
 * it is tested against real repositories without an Electron runtime.
 */

const BRANCH_PREFIX = 'companion';

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
  | { type: 'branch_exists'; branch: string; message: string }
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
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
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
 * Creates the companion half of a lane's pair. Refuses, creating nothing, when
 * the companion is not a main checkout, is on no branch, does not ignore
 * `appFolder` (the lane's checkout would show as untracked files in it), or
 * when the branch or the folder is already taken.
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
  const companionBranch = `${BRANCH_PREFIX}/${args.laneBranch}`;
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
    if (
      await gitAnswers(companion.path, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${companionBranch}`,
      ])
    ) {
      return err({
        type: 'branch_exists',
        branch: companionBranch,
        message: `The companion already has a branch ${companionBranch}.`,
      });
    }
    if (existsSync(companionPath)) {
      return err({
        type: 'path_exists',
        path: companionPath,
        message: `${companionPath} already exists.`,
      });
    }
    const startPoint = await git(companion.path, ['rev-parse', 'HEAD']);
    await git(companion.path, [
      'worktree',
      'add',
      '-b',
      companionBranch,
      companionPath,
      startPoint,
    ]);
    return ok({
      companionPath,
      companionBranch,
      appPath: path.join(companionPath, companion.appFolder),
    });
  } catch (error) {
    return err(gitFailed('Creating the companion checkout', error));
  }
}

/**
 * Removes the companion half after the lane's own checkout is gone. Its branch
 * stays, as a lane's does. Refuses while the lane's checkout is still nested in
 * it (removing the folder would take it along) and while the companion
 * checkout has changes, which are the user's work, not the lane's.
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
  try {
    // --ignored as well: `git worktree remove` deletes ignored files with the folder, and a
    // companion's ignored files (local state, .env) are the user's, not the lane's.
    const appPrefix = `${args.companion.appFolder.replaceAll('\\', '/').replace(/\/+$/, '')}/`;
    const leftovers = (await git(args.companionPath, ['status', '--porcelain', '--ignored']))
      .split('\n')
      .map((line) => line.slice(3))
      .filter((file) => file && !file.startsWith(appPrefix));
    if (leftovers.length > 0) {
      return err({
        type: 'companion_has_changes',
        path: args.companionPath,
        message: `${args.companionPath} holds changes or ignored files nothing else keeps (${leftovers
          .slice(0, 3)
          .join(', ')}); move, commit or discard them first.`,
      });
    }
    await git(args.companion.path, ['worktree', 'remove', args.companionPath]);
    return ok();
  } catch (error) {
    return err(gitFailed('Removing the companion checkout', error));
  }
}
