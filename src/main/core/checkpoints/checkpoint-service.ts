import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { checkpointSavedChannel } from '@shared/events/checkpointEvents';
import { findWorktreeRow, getPrimaryWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { checkpoints, type CheckpointRow } from '@main/db/schema-checkpoints';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  captureCheckpointCommit,
  CHECKPOINT_REF_PREFIX,
  deleteCheckpointRefs,
  pinCheckpointCommit,
  restoreCheckpointCommit,
} from './checkpoint-git';

export interface TurnCheckpointArgs {
  workItemId: string;
  turnId: string;
  sessionId: string | null;
  repoPath: string;
  worktreeId: string;
}

/**
 * Captures the post-turn worktree snapshot and records it. Called
 * fire-and-forget from AgentEventBridge.completeTurn — a capture failure is
 * logged there and never blocks turn completion. Returns the row, or null when
 * the repo has no commits yet (nothing to checkpoint against).
 */
export async function captureTurnCheckpoint(
  args: TurnCheckpointArgs
): Promise<CheckpointRow | null> {
  const id = randomUUID();
  const commit = await captureCheckpointCommit(
    args.repoPath,
    id,
    `Checkpoint: turn ${args.turnId}`
  );
  if (commit === null) return null;

  return insertCheckpointRow({
    id,
    workItemId: args.workItemId,
    turnId: args.turnId,
    sessionId: args.sessionId,
    worktreeId: args.worktreeId,
    commitSha: commit.commitSha,
    branchName: commit.branchName,
    trigger: 'turn_completed',
  });
}

/**
 * A copied turn's own checkpoint (Fork to new tab or worktree): the same
 * snapshot as `source`, under a new id and its own ref, so either can be
 * released without dropping the other's commit. `lane` puts the copy on
 * another lane (Fork to new worktree); otherwise it stays on the source's.
 */
export async function copyTurnCheckpoint(
  source: CheckpointRow,
  copy: {
    turnId: string;
    sessionId: string;
    repoPath: string;
    lane?: { worktreeId: string; branchName: string | null };
  }
): Promise<CheckpointRow> {
  const id = randomUUID();
  await pinCheckpointCommit(copy.repoPath, id, source.commitSha);
  return insertCheckpointRow({
    id,
    workItemId: source.workItemId,
    turnId: copy.turnId,
    sessionId: copy.sessionId,
    worktreeId: copy.lane ? copy.lane.worktreeId : source.worktreeId,
    commitSha: source.commitSha,
    branchName: copy.lane ? copy.lane.branchName : source.branchName,
    trigger: 'turn_completed',
  });
}

export function listCheckpoints(
  workItemId: string,
  opts: { worktreeId?: string } = {}
): CheckpointRow[] {
  const where =
    opts.worktreeId !== undefined
      ? and(eq(checkpoints.workItemId, workItemId), eq(checkpoints.worktreeId, opts.worktreeId))
      : eq(checkpoints.workItemId, workItemId);
  return db.select().from(checkpoints).where(where).orderBy(desc(checkpoints.createdAt)).all();
}

/**
 * Restores a checkpoint's own worktree to its state. The current state of
 * that worktree is itself captured first as a `pre_revert` checkpoint
 * (turn_id NULL, same worktree), so every revert is undoable through the
 * same mechanism. A NULL `worktreeId` (pre-T0.10 rows, or a checkpoint whose
 * worktree was hard-deleted) resolves to the work item's primary — never to
 * whichever worktree happens to be open in the UI.
 */
export async function revertToCheckpoint(
  workItemId: string,
  checkpointId: string
): Promise<{ safetyCheckpointId: string | null }> {
  const [checkpoint] = db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.id, checkpointId))
    .limit(1)
    .all();
  if (!checkpoint || checkpoint.workItemId !== workItemId) {
    throw new Error(`revertToCheckpoint: checkpoint not found: ${checkpointId}`);
  }

  const worktreeRow = checkpoint.worktreeId
    ? findWorktreeRow(checkpoint.worktreeId)
    : getPrimaryWorktreeRow(workItemId);
  if (!worktreeRow) {
    throw new Error(
      `revertToCheckpoint: worktree ${checkpoint.worktreeId} for checkpoint ${checkpointId} no longer exists`
    );
  }
  if (worktreeRow.archivedAt !== null) {
    throw new Error(
      `revertToCheckpoint: worktree ${worktreeRow.id} for checkpoint ${checkpointId} is archived`
    );
  }

  const safetyId = randomUUID();
  const safetyCommit = await captureCheckpointCommit(
    worktreeRow.path,
    safetyId,
    `Checkpoint: pre-revert of ${checkpointId}`
  );
  if (safetyCommit !== null) {
    insertCheckpointRow({
      id: safetyId,
      workItemId,
      turnId: null,
      sessionId: checkpoint.sessionId,
      worktreeId: worktreeRow.id,
      commitSha: safetyCommit.commitSha,
      branchName: safetyCommit.branchName,
      trigger: 'pre_revert',
    });
  }

  await restoreCheckpointCommit(worktreeRow.path, checkpoint.commitSha);
  log.info('[checkpoints] reverted', {
    workItemId,
    checkpointId,
    worktreeId: worktreeRow.id,
    sha: checkpoint.commitSha,
  });
  return { safetyCheckpointId: safetyCommit === null ? null : safetyId };
}

/**
 * Releases everything a deleted work item owns in the repo. Each checkpoint
 * pins a commit behind a `refs/chord/checkpoints/` ref, so without this the
 * snapshots of every work item ever deleted stay reachable forever and the
 * repo grows without bound.
 *
 * Refs go first: a failure there must leave the rows in place so the refs are
 * still discoverable, rather than orphaning them with no record of their names.
 */
export async function deleteWorkItemCheckpoints(
  workItemId: string,
  repoPath: string
): Promise<number> {
  const rows = db
    .select({ gitRef: checkpoints.gitRef })
    .from(checkpoints)
    .where(eq(checkpoints.workItemId, workItemId))
    .all();
  if (rows.length === 0) return 0;

  await deleteCheckpointRefs(
    repoPath,
    rows.map((row) => row.gitRef)
  );
  db.delete(checkpoints).where(eq(checkpoints.workItemId, workItemId)).run();

  log.info('[checkpoints] released refs for deleted work item', {
    workItemId,
    count: rows.length,
  });
  return rows.length;
}

/**
 * Releases the refs for one worktree's checkpoints and drops their rows —
 * the archive-time counterpart to `deleteWorkItemCheckpoints`. Called while
 * the worktree's checkout is still on disk (any checkout of the shared repo
 * would do, since checkpoint refs live in the shared object store, but the
 * worktree about to be archived is guaranteed to still be there).
 *
 * Refs go first, same ordering rationale as `deleteWorkItemCheckpoints`: a
 * failure here must leave the rows in place rather than orphan the refs.
 */
export async function deleteWorktreeCheckpoints(
  worktreeId: string,
  worktreePath: string
): Promise<number> {
  const rows = db
    .select({ gitRef: checkpoints.gitRef })
    .from(checkpoints)
    .where(eq(checkpoints.worktreeId, worktreeId))
    .all();
  if (rows.length === 0) return 0;

  await deleteCheckpointRefs(
    worktreePath,
    rows.map((row) => row.gitRef)
  );
  db.delete(checkpoints).where(eq(checkpoints.worktreeId, worktreeId)).run();

  log.info('[checkpoints] released refs for archived worktree', {
    worktreeId,
    count: rows.length,
  });
  return rows.length;
}

function insertCheckpointRow(row: {
  id: string;
  workItemId: string;
  turnId: string | null;
  sessionId: string | null;
  worktreeId: string | null;
  commitSha: string;
  branchName: string | null;
  trigger: 'turn_completed' | 'pre_revert';
}): CheckpointRow {
  const values = {
    ...row,
    gitRef: `${CHECKPOINT_REF_PREFIX}${row.id}`,
    createdAt: Math.floor(Date.now() / 1000),
  };
  db.insert(checkpoints).values(values).run();
  // A turn's checkpoint lands just after the turn ends; the chat reads it by this.
  events.emit(checkpointSavedChannel, { workItemId: row.workItemId });
  return db.select().from(checkpoints).where(eq(checkpoints.id, row.id)).limit(1).all()[0]!;
}
