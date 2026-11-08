import { toBranchSlug } from './git-branch-name';
import type { CheckoutOrigin } from './worktree-sources';

/**
 * Where a lane's fork commit came from: a fetch that just succeeded, the
 * last-fetched copy of a remote branch the user chose when the fetch failed,
 * or a local-only branch with nothing to fetch.
 */
export type ForkSource = 'fetched' | 'local_copy' | 'local';

/**
 * Renderer-safe view of a `work_item_worktrees` row (`schema-work-items.ts`).
 * The DTO exists so the renderer never imports the drizzle row type — same
 * split as every other `core/*` domain.
 */
export interface Worktree {
  id: string;
  workItemId: string;
  path: string;
  branchName: string | null;
  baseBranch: string | null;
  /** Where this lane's PR merges, e.g. `origin/main`. Null on lanes from before it was recorded. */
  targetRef: string | null;
  /** Null: setup is not tracked for this lane (created before it was). */
  setupStatus: 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | null;
  /** Null for a checkout of an existing branch, and for lanes from before it was recorded. */
  forkSource: ForkSource | null;
  /** 'adopted': the user's own checkout, which Chord never changes (`@shared/worktree-sources`). */
  checkoutOrigin: CheckoutOrigin;
  /** The companion repository's worktree this lane's checkout is nested in, where its sessions start. */
  companionPath: string | null;
  isPrimary: boolean;
  title: string | null;
  createdAt: number;
  archivedAt: number | null;
}

/**
 * `uncommitted` is a line count of `git status --porcelain` (staged + unstaged
 * + untracked). `unpushed` is `git rev-list --count @{upstream}..HEAD`, or
 * `null` when the branch has no upstream to compare against — a worktree that
 * was never pushed reports no unpushed count rather than a misleading 0.
 */
export interface WorktreeArchiveInspection {
  uncommitted: number;
  unpushed: number | null;
  /**
   * Archive may also delete the branch: its PR is merged, the branch has
   * nothing after the merged head, and nothing is uncommitted.
   */
  branchDeletable: boolean;
}

/** An archived lane, as the left rail's "Archived (n)" group lists it. */
export interface ArchivedLane {
  id: string;
  branchName: string | null;
  title: string | null;
  /** Its branch is still here to check out again; false once deleted. */
  restorable: boolean;
  /** Files the archive snapshot changes against the branch it was taken on. */
  keptChanges: number;
}

/**
 * The short name a session tab shows for its lane (devstation-5u6): what
 * follows the work item's branch in a Chord lane (`<branch>--fork` → `fork`,
 * see `buildWorktreeBranchName`), else the branch's last segment (an adopted
 * checkout's `feature/login` → `login`).
 */
export function describeLaneTag(branchName: string): string {
  const laneSuffix = branchName.lastIndexOf('--');
  if (laneSuffix !== -1) return branchName.slice(laneSuffix + 2);
  return branchName.slice(branchName.lastIndexOf('/') + 1);
}

/**
 * Names a non-primary worktree's branch off the work item's own branch:
 * `<work-item-branch>--<slug>`. A blank title has no slug to key off, so it
 * falls back to the lowest integer `n >= 2` that isn't already a branch
 * (`--2`, `--3`, ...) — `--1` is skipped because it would read as "the first
 * of many" when there may only ever be one. A titled name that collides (two
 * worktrees titled "Fix bug" off the same branch) gets the same numeric
 * suffix appended instead of colliding silently.
 */
export function buildWorktreeBranchName(
  workItemBranch: string,
  title: string | undefined,
  existingBranches: string[]
): string {
  const trimmedTitle = title?.trim();

  if (!trimmedTitle) {
    let n = 2;
    while (existingBranches.includes(`${workItemBranch}--${n}`)) n += 1;
    return `${workItemBranch}--${n}`;
  }

  const base = `${workItemBranch}--${toBranchSlug(trimmedTitle)}`;
  if (!existingBranches.includes(base)) return base;

  let n = 2;
  while (existingBranches.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
