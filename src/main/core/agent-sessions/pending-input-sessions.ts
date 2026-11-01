import type { StreamItem } from '@shared/stream-items';
import { listPendingHookPrompts } from '@main/core/agent-hooks/pending-hook-prompts';
import type { ActiveSession } from '@main/core/work-items/active-sessions';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';

export interface PendingInputSession {
  sessionId: string;
  workItemId: string;
  worktreeId: string;
}

/**
 * Whether a session's live turn has a permission, question or plan card the user
 * hasn't answered yet. Mirrors `isItemPending` in the renderer's
 * `live-worktree-status-reducer.ts` — items are mutated in place as they
 * settle (see `PlanApprovalTracker.resolveApproval`), so the latest snapshot
 * is enough; no need to replay the action log.
 */
function hasPendingInputItem(items: readonly StreamItem[]): boolean {
  return items.some(
    (item) =>
      (item.kind === 'permission' && !item.resolved) ||
      (item.kind === 'question' && item.status === 'pending') ||
      (item.kind === 'plan_approval' && item.status === 'pending')
  );
}

/**
 * Live sessions blocked on the user: ACP/SDK chat sessions whose in-flight
 * turn snapshot has an unanswered card, plus any live session (PTY chat or
 * terminal agent) with an unanswered hook prompt. One row per session.
 */
export function collectPendingInputSessions(
  active: readonly ActiveSession[]
): PendingInputSession[] {
  const fromTurns = active
    .filter((s) => s.kind === 'chat' && s.bridge)
    .flatMap((s) => {
      const live = s.bridge!.getLiveTurnSnapshot();
      if (!live || !hasPendingInputItem(live.items)) return [];
      const worktree = resolveSessionWorktreeRow(s.sessionId);
      return [{ sessionId: s.sessionId, workItemId: s.workItemId, worktreeId: worktree.id }];
    });
  const seen = new Set(fromTurns.map((s) => s.sessionId));
  const fromHooks = listPendingHookPrompts(new Set(active.map((s) => s.sessionId))).filter(
    (prompt) => !seen.has(prompt.sessionId)
  );
  return [...fromTurns, ...fromHooks];
}
