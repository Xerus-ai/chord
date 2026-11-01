/**
 * Pure filtering rule for which worktrees get a workspace acquired on app
 * boot, kept apart from `workspace-bridge.ts` so it can be unit-tested with
 * fixtures instead of `@main/db/client` — same split as `decisions.ts`.
 *
 * Boot only ever acquires a worktree of an *active*, fully provisioned work
 * item that is not itself archived. A 'provisioning' or 'failed' item's primary
 * still points at the shared repo root; provisioning acquires it on success. The dev DB has work items pointing at repos that were
 * deleted or were never a repo at all (a stale temp e2e checkout, or a work
 * item whose `repoPath` is a plain directory) — this function only decides
 * status/archived eligibility; `workspace-bridge.ts` is responsible for the
 * separate on-disk check before acquiring.
 */
export interface BootWorktreeCandidate {
  worktreeId: string;
  workItemId: string;
  path: string;
  archivedAt: number | null;
  workItemStatus: string;
  /** `work_items.provision_status`: until 'ready', the primary still points at the repo root. */
  provisionStatus: string;
}

export function selectBootWorktrees<T extends BootWorktreeCandidate>(candidates: T[]): T[] {
  return candidates.filter(
    (c) => c.archivedAt === null && c.workItemStatus === 'active' && c.provisionStatus === 'ready'
  );
}
