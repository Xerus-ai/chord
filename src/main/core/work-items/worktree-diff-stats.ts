import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LaneCompareRef } from '@shared/git-settings';
import type { SidebarDiffStats } from '@shared/sidebar-summaries';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import type { WorkItemBranchInfo } from './resolve-branch-info';
import { readUntrackedLineCounts } from './untracked-line-counts';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, { cwd, timeout: 5000 });
    return stdout;
  } catch {
    // A missing worktree, a detached ref, or a path that is not a repo at all.
    // Callers surface this as "unknown", never as zero.
    return null;
  }
}

async function readNumstat(cwd: string, range: string): Promise<SidebarDiffStats | null> {
  const stdout = await runGit(cwd, ['diff', '--numstat', range]);
  if (stdout === null) return null;

  let added = 0;
  let removed = 0;
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [a, r] = line.split('\t');
    added += a === '-' ? 0 : parseInt(a!, 10);
    removed += r === '-' ? 0 : parseInt(r!, 10);
  }
  return { added, removed };
}

/**
 * The checkout's uncommitted changes, new files included — `git diff HEAD`
 * alone never counts an untracked file (devstation-ui4). Unreadable is
 * unknown, as for every other range.
 */
async function readWorkingTreeStats(cwd: string): Promise<SidebarDiffStats | null> {
  const tracked = await readNumstat(cwd, 'HEAD');
  if (tracked === null) return null;
  try {
    const untracked = await readUntrackedLineCounts(cwd);
    return {
      added: untracked.reduce((total, file) => total + file.added, tracked.added),
      removed: tracked.removed,
    };
  } catch (error) {
    log.warn('[sidebar] untracked files unreadable', { cwd, error: String(error) });
    return null;
  }
}

/**
 * Ranges that honestly describe one worktree's changes.
 *
 * Every worktree has its own checkout, so the working tree only belongs to
 * the branch actually checked out there. The committed delta is measured
 * against the resolved compare base (`lane-compare-base.ts`): in repoDefault
 * mode where the lane merges — its recorded `target_ref` (`origin/main`), not
 * the local branch of the same name, which can sit hundreds of commits from it
 * (devstation-sun); in upstream mode the branch's upstream, so only unpushed
 * work counts.
 *
 * In repoDefault mode a base that names the checked-out branch itself (a root
 * `main` against `origin/main`) has no committed delta to report. An upstream
 * always names the branch (`origin/chord/x` for `chord/x`), and is exactly the
 * base asked for.
 */
function diffRangesFor(
  branchName: string | null,
  base: LaneCompareRef,
  ctx: WorkItemBranchInfo
): string[] {
  const ranges: string[] = [];
  const branch = branchName ?? ctx.currentBranch;
  const namesBranch = !!branch && (base.ref === branch || base.ref.endsWith(`/${branch}`));
  if (branch && !(base.mode === 'repoDefault' && namesBranch)) {
    ranges.push(`${base.ref}...${branch}`);
  }
  if (branchName === null || branchName === ctx.currentBranch) ranges.push('HEAD');
  return ranges;
}

export async function readWorktreeDiffStats(
  worktreePath: string,
  branchName: string | null,
  base: LaneCompareRef,
  ctx: WorkItemBranchInfo | null
): Promise<SidebarDiffStats | null> {
  if (!ctx) return null;

  const results = await Promise.all(
    diffRangesFor(branchName, base, ctx).map((range) =>
      range === 'HEAD' ? readWorkingTreeStats(worktreePath) : readNumstat(worktreePath, range)
    )
  );

  const known = results.filter((r): r is SidebarDiffStats => r !== null);
  if (known.length === 0) return null;
  return known.reduce(
    (total, stats) => ({
      added: total.added + stats.added,
      removed: total.removed + stats.removed,
    }),
    { added: 0, removed: 0 }
  );
}

/** Sums diff stats across worktrees; null only when every worktree is unknown. */
export function aggregateDiffStats(
  stats: ReadonlyArray<SidebarDiffStats | null>
): SidebarDiffStats | null {
  const known = stats.filter((s): s is SidebarDiffStats => s !== null);
  if (known.length === 0) return null;
  return known.reduce(
    (total, s) => ({ added: total.added + s.added, removed: total.removed + s.removed }),
    { added: 0, removed: 0 }
  );
}
