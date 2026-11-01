import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export const CHECKPOINT_REF_PREFIX = 'refs/chord/checkpoints/';

export interface CheckpointCommit {
  commitSha: string;
  branchName: string | null;
}

async function runGit(repoPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: env ? { ...process.env, ...env } : undefined,
  });
  return stdout;
}

async function resolveHead(repoPath: string): Promise<string | null> {
  try {
    return (await runGit(repoPath, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    // Unborn branch — a repo with no commits has nothing to checkpoint against.
    return null;
  }
}

/**
 * Runs `fn` with a throwaway index file so staging operations never touch the
 * user's real index. The temp index lives outside the repo to keep it away
 * from `git add -A` and status scans.
 */
async function withTempIndex<T>(
  repoPath: string,
  fn: (env: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  const tempIndex = path.join(os.tmpdir(), `chord-checkpoint-index-${randomUUID()}`);
  try {
    return await fn({ GIT_INDEX_FILE: tempIndex });
  } finally {
    await rm(tempIndex, { force: true });
  }
}

/**
 * Snapshots the full worktree state (tracked modifications + untracked,
 * non-ignored files) into a commit parented on HEAD, anchored against GC by a
 * ref under `refs/chord/checkpoints/`. The user's index and worktree are never
 * touched — all staging happens in a temp index.
 *
 * Returns null for a repo with no commits (unborn HEAD): a designed outcome,
 * there is no base state to checkpoint against, not an error swallow.
 */
export async function captureCheckpointCommit(
  repoPath: string,
  checkpointId: string,
  message: string
): Promise<CheckpointCommit | null> {
  const headSha = await resolveHead(repoPath);
  if (headSha === null) return null;

  const branchOut = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const branchName = branchOut === 'HEAD' ? null : branchOut;

  // Queued with the repo's other index writers even though the staging runs in
  // a temp index: a concurrent revert rewrites the worktree underneath `add -A`
  // and the snapshot would record a half-restored tree.
  const commitSha = await enqueueRepoIndexOp(repoPath, async () => {
    const treeSha = await writeWorktreeTree(repoPath, headSha);
    return (await runGit(repoPath, ['commit-tree', treeSha, '-p', headSha, '-m', message])).trim();
  });

  await pinCheckpointCommit(repoPath, checkpointId, commitSha);
  return { commitSha, branchName };
}

/** Anchors `commitSha` against GC under checkpoint `checkpointId`'s own ref. */
export async function pinCheckpointCommit(
  repoPath: string,
  checkpointId: string,
  commitSha: string
): Promise<void> {
  await runGit(repoPath, ['update-ref', `${CHECKPOINT_REF_PREFIX}${checkpointId}`, commitSha]);
}

/**
 * Writes the worktree's full state (tracked modifications + untracked,
 * non-ignored files) as a tree, staged in a temp index seeded from
 * `baseCommit`, and returns its sha. The user's index and files are never
 * touched. Not queued: the caller holds the repo's index queue
 * (`enqueueRepoIndexOp`), so a concurrent writer cannot rewrite the worktree
 * underneath `add -A`.
 */
export async function writeWorktreeTree(repoPath: string, baseCommit: string): Promise<string> {
  return withTempIndex(repoPath, async (env) => {
    await runGit(repoPath, ['read-tree', baseCommit], env);
    await runGit(repoPath, ['add', '-A'], env);
    return (await runGit(repoPath, ['write-tree'], env)).trim();
  });
}

/**
 * Makes the worktree match the checkpoint commit's tree:
 *  - files tracked-or-untracked now but absent from the checkpoint are deleted
 *    (ignored files are untouched — they were never captured),
 *  - every checkpoint file is written out via a temp-index checkout,
 *  - the real index is reset to HEAD so all checkpoint-vs-HEAD deltas surface
 *    as unstaged changes and `git status` stays coherent.
 */
export async function restoreCheckpointCommit(repoPath: string, commitSha: string): Promise<void> {
  await enqueueRepoIndexOp(repoPath, () => restoreWorktreeToCommit(repoPath, commitSha));
}

async function restoreWorktreeToCommit(repoPath: string, commitSha: string): Promise<void> {
  const currentOut = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '-co',
    '--exclude-standard',
  ]);
  const targetOut = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'ls-tree',
    '-r',
    '--name-only',
    commitSha,
  ]);

  const targetFiles = new Set(targetOut.split('\n').filter(Boolean));
  const extras = currentOut
    .split('\n')
    .filter(Boolean)
    .filter((file) => !targetFiles.has(file));

  for (const file of extras) {
    await rm(path.join(repoPath, file), { force: true });
  }

  await withTempIndex(repoPath, async (env) => {
    await runGit(repoPath, ['read-tree', commitSha], env);
    await runGit(repoPath, ['checkout-index', '-a', '-f'], env);
  });

  await runGit(repoPath, ['reset', '-q']);
}

/**
 * Drops the refs anchoring a set of checkpoint commits, releasing them to git's
 * normal garbage collection. `update-ref -d` on a ref that is already gone is a
 * no-op, so a partially collected set is not an error.
 */
export async function deleteCheckpointRefs(repoPath: string, gitRefs: string[]): Promise<void> {
  for (const gitRef of gitRefs) {
    if (!gitRef.startsWith(CHECKPOINT_REF_PREFIX)) {
      throw new Error(`deleteCheckpointRefs: refusing to delete non-checkpoint ref ${gitRef}`);
    }
    await runGit(repoPath, ['update-ref', '-d', gitRef]);
  }
}
