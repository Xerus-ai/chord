import type { WorktreeArchiveInspection } from '@shared/worktrees';

/**
 * Pure decisions for the left rail's lane rows (UI: "branch"): the label,
 * which actions a row offers, the delete confirm's words, and what Open
 * focuses. The rows themselves (`lane-row.tsx`) only render these.
 */

/** Enabled, or shown disabled with what to do instead — never hidden. */
export type LaneAction = { enabled: true } | { enabled: false; reason: string };

export interface LaneRowActions {
  promote: LaneAction;
  copyBranch: LaneAction;
  archive: LaneAction;
  delete: LaneAction;
}

/** "branch → target": where the lane merges is part of what it is. */
export function formatLaneRoute(lane: {
  branch: string | null;
  targetRef: string | null;
}): string | null {
  if (lane.branch === null) return null;
  return lane.targetRef === null ? lane.branch : `${lane.branch} → ${lane.targetRef}`;
}

export function planLaneRowActions(lane: {
  isPrimary: boolean;
  branch: string | null;
}): LaneRowActions {
  return {
    promote: lane.isPrimary
      ? { enabled: false, reason: 'Already the primary branch' }
      : { enabled: true },
    copyBranch:
      lane.branch === null
        ? { enabled: false, reason: 'No branch is recorded for this checkout' }
        : { enabled: true },
    archive: lane.isPrimary
      ? { enabled: false, reason: 'The work item opens to its primary branch' }
      : { enabled: true },
    // The work item opens to its primary and its repo path points at it.
    delete: lane.isPrimary
      ? { enabled: false, reason: 'Promote another branch first, or delete the work item' }
      : { enabled: true },
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What Delete will cost, from `worktrees.inspectArchive`. Only uncommitted
 * changes are lost: the branch is kept, so unpushed commits survive — but on
 * this machine only, which the user should know before the checkout goes.
 */
export function describeLaneDeleteConfirm(args: {
  branch: string | null;
  inspection: Pick<WorktreeArchiveInspection, 'uncommitted' | 'unpushed'>;
}): { title: string; description: string } {
  const { uncommitted, unpushed } = args.inspection;
  const sentences = [
    "Removes this branch's checkout and its sessions from this machine. The branch and its commits stay in the repository.",
  ];
  if (uncommitted > 0) {
    sentences.push(
      `${count(uncommitted, 'uncommitted change', 'uncommitted changes')} in the checkout will be lost.`
    );
  }
  if (unpushed === null) {
    sentences.push('The branch has never been pushed: its commits are on this machine only.');
  } else if (unpushed > 0) {
    sentences.push(
      unpushed === 1
        ? "1 commit isn't pushed: it stays on the branch on this machine only."
        : `${unpushed} commits aren't pushed: they stay on the branch on this machine only.`
    );
  }
  return {
    title: args.branch === null ? 'Delete this checkout?' : `Delete ${args.branch}?`,
    description: sentences.join(' '),
  };
}

export interface LaneSessionFacts {
  id: string;
  /** Null means the primary lane (`worktree-lookup.ts`). */
  worktreeId: string | null;
  status: string;
  lastActiveAt: number;
}

export type LaneOpenTarget = { kind: 'session'; sessionId: string } | { kind: 'new-terminal' };

/**
 * The centre's focused lane is the one behind its active tab
 * (`use-focused-worktree.ts`), so opening a lane means activating something
 * that runs in it: its most recently active running session, or a new
 * terminal there.
 */
export function pickLaneOpenTarget(
  lane: { id: string; isPrimary: boolean },
  sessions: readonly LaneSessionFacts[]
): LaneOpenTarget {
  const newest = sessions
    .filter((session) => session.status !== 'done')
    .filter((session) =>
      session.worktreeId === null ? lane.isPrimary : session.worktreeId === lane.id
    )
    .reduce<LaneSessionFacts | null>(
      (best, session) => (!best || session.lastActiveAt > best.lastActiveAt ? session : best),
      null
    );
  return newest ? { kind: 'session', sessionId: newest.id } : { kind: 'new-terminal' };
}
