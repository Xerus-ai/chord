import type { ArchivedLane, WorktreeArchiveInspection } from '@shared/worktrees';

/**
 * The words of Archive and of the "Archived (n)" group (plan §"Decisions for
 * Phase 5"): archiving keeps everything but the checkout, so the confirm says
 * what is kept rather than what is lost.
 */

function files(n: number): string {
  return n === 1 ? '1 uncommitted file is' : `${n} uncommitted files are`;
}

export function describeLaneArchiveConfirm(args: {
  branch: string | null;
  inspection: WorktreeArchiveInspection;
}): { title: string; description: string; offerBranchDelete: boolean } {
  const { uncommitted, branchDeletable } = args.inspection;
  const sentences = [
    "Removes this branch's checkout from this machine. The branch, its commits and its chat history are kept, and Restore brings the checkout back.",
  ];
  if (uncommitted > 0) sentences.push(`${files(uncommitted)} kept with the archive.`);
  if (branchDeletable) {
    sentences.push(
      'Its pull request is merged and the branch has nothing newer, so the branch can go too.'
    );
  }
  return {
    title: args.branch === null ? 'Archive this checkout?' : `Archive ${args.branch}?`,
    description: sentences.join(' '),
    offerBranchDelete: branchDeletable,
  };
}

/** An archived lane's row: its name, what it keeps, and whether Restore is offered. */
export function describeArchivedLane(
  lane: Pick<ArchivedLane, 'branchName' | 'title' | 'restorable' | 'keptChanges'>
): { label: string; detail: string; canRestore: boolean } {
  const label = lane.title ?? lane.branchName ?? 'Checkout';
  if (!lane.restorable) {
    return { label, detail: 'Branch deleted, nothing to restore', canRestore: false };
  }
  const detail =
    lane.keptChanges === 0
      ? 'Branch kept'
      : `${lane.keptChanges} uncommitted ${lane.keptChanges === 1 ? 'file' : 'files'} kept`;
  return { label, detail, canRestore: true };
}
