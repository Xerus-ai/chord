import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItemWorktrees } from '@main/db/schema-work-items';

/**
 * Records the outcome of a commit/push attempt against a worktree — the
 * durable `gitOperationFailed` source for sidebar-worktree-summaries.ts.
 * `error: null` clears the flag (the next success on this worktree); a
 * non-null message sets it, stamped with when it happened. Never throws:
 * callers (commit-and-push.ts) run this alongside the real git operation and
 * must not let a status-write failure mask or replace the operation's own
 * error.
 */
export function recordGitOperationOutcome(worktreeId: string, error: string | null): void {
  const now = Math.floor(Date.now() / 1000);
  db.update(workItemWorktrees)
    .set({ gitLastError: error, gitLastErrorAt: error ? now : null })
    .where(eq(workItemWorktrees.id, worktreeId))
    .run();
}
