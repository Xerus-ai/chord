import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitChange } from '@shared/git';
import type { CompareBaseMode, LaneCompareBase, LaneCompareRef } from '@shared/git-settings';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { readBranchRemoteCopy } from '@main/core/git/impl/git-branch-publication';
import { parseNumstat } from '@main/core/git/impl/git-status-ops';
import { mapStatus } from '@main/core/git/impl/git-utils';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { WorkItemBranchInfo } from './resolve-branch-info';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5_000;

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, ['-c', 'core.quotePath=false', ...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

/** Whether `ref` (a full ref name) exists; git answers a missing one with exit 1. */
async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(cwd, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

/**
 * The base a lane's committed changes are measured against (Settings › Git ›
 * Compare base). `repoDefault` is where the lane merges: its `target_ref`, or
 * the repository's default branch for a row from before lanes recorded one.
 *
 * `upstream` is the branch's own remote copy — where Chord's Push writes it
 * (`origin/chord/x` once published), read by `readBranchRemoteCopy`, the same
 * function the ahead count uses — so only unpushed work counts. A tracking
 * config unset by hand does not hide a copy that is still there, and a
 * configured `@{upstream}` that is some other branch (a branch created from
 * `origin/main` with tracking on) is not where this branch's work is pushed,
 * and is not used.
 *
 * With no upstream there is no fallback to the repository default: a branch
 * never pushed, a detached checkout, and a remote copy that is gone are
 * `no_upstream`, so the UI can say so instead of showing another base's
 * numbers under this name.
 */
export async function resolveLaneCompareBase(
  lane: {
    worktreePath: string;
    branchName: string | null;
    targetRef: string | null;
    branchInfo: WorkItemBranchInfo;
  },
  mode: CompareBaseMode
): Promise<LaneCompareBase> {
  if (mode === 'repoDefault') {
    return { kind: 'ref', mode, ref: lane.targetRef ?? lane.branchInfo.defaultBranch };
  }

  const branch = lane.branchName ?? lane.branchInfo.currentBranch;
  if (!branch) return { kind: 'no_upstream', branch: null };
  if (!(await refExists(lane.worktreePath, `refs/heads/${branch}`))) {
    throw new Error(`Branch ${branch} does not exist in ${lane.worktreePath}`);
  }

  const remoteCopy = await readBranchRemoteCopy(
    new LocalExecutionContext({ root: lane.worktreePath }),
    branch
  );
  if (!remoteCopy) return { kind: 'no_upstream', branch };
  return { kind: 'ref', mode, ref: remoteCopy };
}

/**
 * What the checkout's commits changed since they left `base`: the merge-base
 * diff `base...HEAD`, so commits the base gained meanwhile are not shown
 * reversed. Renames are a delete plus an add, so both stat reads key on one
 * path. A base git cannot resolve throws — it is not "no changes".
 *
 * Both reads settle before it returns or throws: with `Promise.all` the first
 * failure rejected while the other git was still running in the checkout,
 * so a caller removing the worktree next hit EPERM on Windows.
 */
export async function readLaneCommittedChanges(
  worktreePath: string,
  base: LaneCompareRef
): Promise<GitChange[]> {
  const range = `${base.ref}...HEAD`;
  const [numstatRead, nameStatusRead] = await Promise.allSettled([
    runGit(worktreePath, ['diff', '--no-renames', '--numstat', range]),
    runGit(worktreePath, ['diff', '--no-renames', '--name-status', range]),
  ]);
  if (numstatRead.status === 'rejected') throw numstatRead.reason;
  if (nameStatusRead.status === 'rejected') throw nameStatusRead.reason;
  const numstat = numstatRead.value;
  const nameStatus = nameStatusRead.value;
  const stats = parseNumstat(numstat);

  return nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code = '', ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      const stat = stats.get(filePath);
      return {
        path: filePath,
        status: mapStatus(code),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      };
    });
}
