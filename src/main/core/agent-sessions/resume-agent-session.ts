import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import { err, ok } from '@shared/result';
import { claudeConversationExists } from '@main/core/agent-sessions/claude-conversation-store';
import { resumeShellTerminalSession } from '@main/core/agent-sessions/shell-terminal';
import { getActiveSessions } from '@main/core/work-items/active-sessions';
import { startSession } from '@main/core/work-items/session-service';
import { resolveSessionLaneEnv } from '@main/core/work-items/session-task-env';
import {
  findWorktreeRow,
  getPrimaryWorktreeRow,
  laneSessionCwd,
} from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, workItems } from '@main/db/schema-work-items';

/**
 * Starts a session that is not running, resuming its conversation when it
 * has one; a running session is returned as it is. Used by the session tabs
 * and by Reset to here, which brings the chat back up on its fork.
 */
export async function resumeAgentSession(sessionId: string) {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  if (!row) return err({ type: 'not_found' as const });

  const active = getActiveSessions(row.workItemId).find((s) => s.sessionId === sessionId);
  if (active) return ok({ session: row });

  const [item] = await db.select().from(workItems).where(eq(workItems.id, row.workItemId)).limit(1);
  if (!item) return err({ type: 'not_found' as const });

  // A session's worktree can be archived (directory removed) after the
  // session went idle; resuming it would spawn into a missing path.
  if (row.worktreeId) {
    const worktreeRow = findWorktreeRow(row.worktreeId);
    if (worktreeRow?.archivedAt != null) return err({ type: 'worktree_archived' as const });
  }

  const cwd = resolve(row.cwd ?? laneSessionCwd(getPrimaryWorktreeRow(row.workItemId)));

  if (row.shell) {
    return resumeShellTerminalSession({ ...row, shell: row.shell, cwd });
  }

  const requestedProvider = row.agentProviderId ?? item.agentProvider;
  if (!isValidProviderId(requestedProvider)) {
    return err({ type: 'no_agent_provider' as const });
  }
  const providerId: AgentProviderId = requestedProvider;

  // Resume only what can actually be resumed: no external session id means
  // no conversation, and a claude id whose conversation was never persisted
  // (terminal opened, nothing exchanged) would die with "No conversation
  // found". Those relaunch fresh — with the same --session-id, so the id
  // becomes a real conversation from here on.
  let isResuming = row.externalSessionId !== null;
  if (
    isResuming &&
    providerId === 'claude' &&
    !claudeConversationExists(cwd, row.externalSessionId as string)
  ) {
    isResuming = false;
  }

  await startSession(sessionId, row.workItemId, {
    cwd,
    providerId,
    kind: row.kind as 'chat' | 'terminal',
    isResuming,
    externalSessionId: row.externalSessionId ?? undefined,
    taskEnvVars: await resolveSessionLaneEnv(sessionId),
  });

  const [updated] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  return ok({ session: updated });
}
