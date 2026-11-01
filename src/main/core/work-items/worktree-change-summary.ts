import { existsSync } from 'node:fs';
import type { CompareBaseMode } from '@shared/git-settings';
import type { SidebarDiffStats, WorktreeCompareState } from '@shared/sidebar-summaries';
import { resolveLaneCompareBase } from './lane-compare-base';
import { resolveWorkItemBranchInfo, type WorkItemBranchInfo } from './resolve-branch-info';
import { readWorktreeDiffStats } from './worktree-diff-stats';

/** A checkout's branch facts, or why they could not be read. */
export type WorktreeBranchState =
  | { kind: 'readable'; info: WorkItemBranchInfo }
  | { kind: 'unreadable'; message: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads one checkout's branch facts for the sidebar. A folder deleted outside
 * Chord, or one git refuses, is a state of that lane — reported with the
 * reason — not a failure of every work item's summary.
 */
export async function readWorktreeBranchState(worktreePath: string): Promise<WorktreeBranchState> {
  if (!existsSync(worktreePath)) {
    return { kind: 'unreadable', message: `The checkout folder ${worktreePath} is missing.` };
  }
  try {
    return { kind: 'readable', info: await resolveWorkItemBranchInfo(worktreePath) };
  } catch (error) {
    return {
      kind: 'unreadable',
      message: `Git could not read ${worktreePath}: ${describeError(error)}`,
    };
  }
}

export interface WorktreeChangeSummary {
  compareBase: WorktreeCompareState;
  diffStats: SidebarDiffStats | null;
}

/**
 * One lane's +/− and the base it is counted against (Settings › Git ›
 * Compare base). `no_upstream` and `unreadable` carry no stats: a count
 * against another base, or a zero, would be a wrong answer under this name.
 */
export async function readWorktreeChangeSummary(
  worktree: { path: string; branchName: string | null; targetRef: string | null },
  branch: WorktreeBranchState,
  mode: CompareBaseMode
): Promise<WorktreeChangeSummary> {
  if (branch.kind === 'unreadable') return { compareBase: branch, diffStats: null };

  let compareBase: WorktreeCompareState;
  try {
    compareBase = await resolveLaneCompareBase(
      {
        worktreePath: worktree.path,
        branchName: worktree.branchName,
        targetRef: worktree.targetRef,
        branchInfo: branch.info,
      },
      mode
    );
  } catch (error) {
    compareBase = {
      kind: 'unreadable',
      message: `Could not read the compare base of ${worktree.branchName ?? worktree.path}: ${describeError(error)}`,
    };
  }
  if (compareBase.kind !== 'ref') return { compareBase, diffStats: null };
  return {
    compareBase,
    diffStats: await readWorktreeDiffStats(
      worktree.path,
      worktree.branchName,
      compareBase,
      branch.info
    ),
  };
}
