import { resolve } from 'node:path';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { err, ok, type Result } from '@shared/result';
import {
  getPrimaryWorktreeRow,
  resolveSessionWorktreeRow,
} from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, type AgentSessionRow } from '@main/db/schema-work-items';

/**
 * DB-touching decision logic for `sendMessageToAgent`'s two entry shapes —
 * pulled out of send-to-agent.ts so it doesn't push the orchestration file
 * past the 400-line limit. The one PURE guard in this area,
 * `validateTargetSession`, lives in its own `validate-target-session.ts`
 * instead of here, so it stays unit-testable without loading
 * `@main/db/client` (see that file's docstring).
 */

/** The worktree cwd an explicitly-targeted session's own worktree resolves to. */
export function resolveTargetSessionCwd(
  sessionId: string
): Result<string, { type: 'worktree_archived'; message: string }> {
  const worktree = resolveSessionWorktreeRow(sessionId);
  if (worktree.archivedAt != null) {
    return err({
      type: 'worktree_archived',
      message: "That session's worktree has been archived.",
    });
  }
  return ok(resolve(worktree.path));
}

/**
 * The newest suspended chat row for the provider, resumable because it still
 * has an external session id to resume via. Used only by the default
 * (no explicit `sessionId`) send path.
 */
export async function findResumableChatRow(
  workItemId: string,
  providerId: AgentProviderId
): Promise<AgentSessionRow | undefined> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.workItemId, workItemId),
        eq(agentSessions.kind, 'chat'),
        eq(agentSessions.status, 'suspended'),
        eq(agentSessions.agentProviderId, providerId),
        isNotNull(agentSessions.externalSessionId)
      )
    )
    .orderBy(desc(agentSessions.lastActiveAt))
    .limit(1);
  return rows[0];
}

/** Where a brand-new chat session for the work item is born: its primary worktree. */
export function resolveNewChatSessionWorktree(workItemId: string): {
  worktreeId: string;
  cwd: string;
} {
  const primary = getPrimaryWorktreeRow(workItemId);
  return { worktreeId: primary.id, cwd: resolve(primary.path) };
}
