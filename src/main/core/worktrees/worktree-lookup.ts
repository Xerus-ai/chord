import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import {
  agentSessions,
  workItemWorktrees,
  type WorkItemWorktreeRow,
} from '@main/db/schema-work-items';

/**
 * Synchronous worktree lookups for main-process readers that used to take a
 * work item's single `repoPath`. Import-light on purpose (db + schema only) so
 * session, pty, checkpoint, and chat modules can depend on it without cycles.
 */

export function findWorktreeRow(worktreeId: string): WorkItemWorktreeRow | undefined {
  return db
    .select()
    .from(workItemWorktrees)
    .where(eq(workItemWorktrees.id, worktreeId))
    .limit(1)
    .all()[0];
}

/**
 * The worktree checked out at this path. Rows aren't required to have a
 * unique path (pre-worktree installs share the repo root across items — see
 * `path` column comment), so the first match is used; callers with a path
 * that came straight off a `work_item_worktrees` row (the common case) never
 * hit that ambiguity.
 */
export function findWorktreeRowByPath(path: string): WorkItemWorktreeRow | undefined {
  return db
    .select()
    .from(workItemWorktrees)
    .where(eq(workItemWorktrees.path, path))
    .limit(1)
    .all()[0];
}

/**
 * Where a lane's agents and terminals start: the companion worktree its
 * checkout is nested in (`work-items/companion-checkout.ts`), so a tool run at
 * the companion's root sees both, as in the main checkouts; else the checkout.
 * Its git (checkpoints, diffs, setup) stays the checkout's own.
 */
export function laneSessionCwd(lane: { path: string; companionPath: string | null }): string {
  return resolve(lane.companionPath ?? lane.path);
}

/** Every work item has exactly one primary worktree from migration 0033 on; a missing one is a bug. */
export function getPrimaryWorktreeRow(workItemId: string): WorkItemWorktreeRow {
  const row = db
    .select()
    .from(workItemWorktrees)
    .where(and(eq(workItemWorktrees.workItemId, workItemId), eq(workItemWorktrees.isPrimary, 1)))
    .limit(1)
    .all()[0];
  if (!row) throw new Error(`Work item ${workItemId} has no primary worktree`);
  return row;
}

/**
 * The worktree a session runs in. A session with no `worktree_id` (its
 * worktree row was deleted, which sets the column null) runs in the primary.
 */
export function resolveSessionWorktreeRow(sessionId: string): WorkItemWorktreeRow {
  const session = db
    .select({ workItemId: agentSessions.workItemId, worktreeId: agentSessions.worktreeId })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .all()[0];
  if (!session) throw new Error(`Agent session ${sessionId} does not exist`);
  if (!session.worktreeId) return getPrimaryWorktreeRow(session.workItemId);
  const row = findWorktreeRow(session.worktreeId);
  if (!row)
    throw new Error(`Agent session ${sessionId} points at missing worktree ${session.worktreeId}`);
  return row;
}
