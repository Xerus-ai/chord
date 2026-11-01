import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeWorktreeTree } from '@main/core/checkpoints/checkpoint-git';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';

/**
 * The git half of Archive and Restore (plan §"Decisions for Phase 5"). An
 * archived lane's uncommitted work (tracked and untracked, not ignored) is a
 * commit on its HEAD, anchored at `refs/chord/archive/<laneId>`. Refs live in
 * the repository's shared object store, so any checkout of it can read or
 * release them, including after the lane's own checkout is gone.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;

export const ARCHIVE_REF_PREFIX = 'refs/chord/archive/';

export function archiveRefFor(laneId: string): string {
  return `${ARCHIVE_REF_PREFIX}${laneId}`;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
}

/** The commit `ref` names, or null when there is no such ref (or object). */
async function resolveRef(repoPath: string, ref: string): Promise<string | null> {
  try {
    return await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch (error) {
    // `--verify --quiet` exits 1 with no output when the ref does not exist.
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

/** Snapshots the lane's checkout as a commit on its HEAD under the lane's archive ref. */
export async function snapshotLaneForArchive(lanePath: string, laneId: string): Promise<string> {
  const head = await runGit(lanePath, ['rev-parse', '--verify', 'HEAD']);
  // Queued with the repo's other index writers: a concurrent revert must not
  // rewrite the worktree underneath `add -A`.
  const commit = await enqueueRepoIndexOp(lanePath, async () => {
    const tree = await writeWorktreeTree(lanePath, head);
    return runGit(lanePath, ['commit-tree', tree, '-p', head, '-m', `Archive of lane ${laneId}`]);
  });
  await runGit(lanePath, ['update-ref', archiveRefFor(laneId), commit]);
  return commit;
}

export function readArchiveSnapshot(repoPath: string, laneId: string): Promise<string | null> {
  return resolveRef(repoPath, archiveRefFor(laneId));
}

/** How many files the snapshot changes against the HEAD it was taken on. */
export async function countArchivedChanges(repoPath: string, snapshot: string): Promise<number> {
  const names = await runGit(repoPath, ['diff', '--name-only', `${snapshot}^`, snapshot]);
  return names.split('\n').filter(Boolean).length;
}

/** Releases archive refs; one already gone is fine. */
export async function releaseArchiveRefs(
  repoPath: string,
  laneIds: readonly string[]
): Promise<void> {
  for (const laneId of laneIds) {
    if ((await readArchiveSnapshot(repoPath, laneId)) === null) continue;
    await runGit(repoPath, ['update-ref', '-d', archiveRefFor(laneId)]);
  }
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  return (await resolveRef(repoPath, `refs/heads/${branch}`)) !== null;
}

/** Commits on `branch` that `base` does not have; null when `base` is not in this clone. */
export async function countCommitsAhead(
  repoPath: string,
  base: string,
  branch: string
): Promise<number | null> {
  if ((await resolveRef(repoPath, base)) === null) return null;
  return Number(await runGit(repoPath, ['rev-list', '--count', `${base}..refs/heads/${branch}`]));
}

export async function deleteLaneBranch(repoPath: string, branch: string): Promise<void> {
  await runGit(repoPath, ['branch', '-D', branch]);
}

/** The worktree that has `branch` checked out, if any. */
async function findBranchCheckout(repoPath: string, branch: string): Promise<string | null> {
  const listing = await runGit(repoPath, ['worktree', 'list', '--porcelain']);
  let current: string | null = null;
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    if (line === `branch refs/heads/${branch}` && current !== null) return current;
  }
  return null;
}

export type RestoreCheckoutError = { type: 'branch_checked_out'; path: string };

/**
 * Checks `branch` out again at the lane's own path. Registrations of
 * checkouts deleted outside git are pruned first, so a stale one cannot
 * claim the branch.
 */
export async function restoreLaneCheckout(
  repoPath: string,
  lanePath: string,
  branch: string
): Promise<RestoreCheckoutError | null> {
  await runGit(repoPath, ['worktree', 'prune']);
  const holder = await findBranchCheckout(repoPath, branch);
  if (holder !== null) return { type: 'branch_checked_out', path: holder };
  await mkdir(path.dirname(lanePath), { recursive: true });
  await runGit(repoPath, ['worktree', 'add', lanePath, branch]);
  return null;
}
