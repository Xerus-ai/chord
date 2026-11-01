import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { claudeConversationExists } from '@main/core/agent-sessions/claude-conversation-store';
import { forgetEndedSession } from '@main/core/agent-sessions/forget-ended-session';
import { collectPendingInputSessions } from '@main/core/agent-sessions/pending-input-sessions';
import { selectRunningWorkItemIds } from '@main/core/agent-sessions/running-work-items';
import { readSessionRowSummaries } from '@main/core/agent-sessions/session-row-summaries';
import { createShellTerminalSession } from '@main/core/agent-sessions/shell-terminal';
import { listActiveSessions } from '@main/core/work-items/active-sessions';
import { startSession, stopSession } from '@main/core/work-items/session-service';
import { resolveSessionLaneEnv } from '@main/core/work-items/session-task-env';
import {
  findWorktreeRow,
  getPrimaryWorktreeRow,
  resolveSessionWorktreeRow,
} from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, workItems, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { announceSessionsChanged } from './announce-sessions-changed';
import { chatControlProcedures } from './chat-control-procedures';
import { resumeAgentSession } from './resume-agent-session';
import { scheduleSessionCloudSync } from './session-cloud-sync';
import { validateSessionWorktree, type WorktreeValidationError } from './session-worktree';

/**
 * Resolves the worktree a new session should run in: the caller's explicit
 * choice (validated against the work item and archive state) or the work
 * item's primary worktree.
 */
function resolveCreateWorktree(
  workItemId: string,
  worktreeId: string | undefined
): { ok: true; row: WorkItemWorktreeRow } | { ok: false; error: WorktreeValidationError } {
  if (worktreeId === undefined) {
    return { ok: true, row: getPrimaryWorktreeRow(workItemId) };
  }
  const result = validateSessionWorktree(findWorktreeRow(worktreeId), workItemId);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, row: result.data };
}

export const agentSessionsController = createRPCController({
  /** Live agent conversations right now. The sidebar seeds its running state
      from this at mount — agent events alone only reveal work items that
      happen to emit while it is listening. */
  listRunningWorkItemIds: async () => {
    return ok({ workItemIds: selectRunningWorkItemIds(listActiveSessions()) });
  },

  /** Per-session seed for the live worktree status store (T0.7): the same
      live-conversation snapshot as `listRunningWorkItemIds`, but resolved down
      to the worktree each session runs in so a multi-worktree work item's
      sidebar/tab state doesn't collapse every session onto one row. Only
      `chat` sessions count — a terminal is a shell the user drives, not an
      agent the work item is waiting on (see `selectRunningWorkItemIds`). */
  listRunningSessions: async () => {
    const sessions = listActiveSessions()
      .filter((s) => s.kind === 'chat')
      .map((s) => {
        const worktree = resolveSessionWorktreeRow(s.sessionId);
        return { sessionId: s.sessionId, workItemId: s.workItemId, worktreeId: worktree.id };
      });
    return ok({ sessions });
  },

  /** Mount-time seed for the needs-input dot (workspace-shell Phase 1 §3.3):
      sessions already blocked on the user — an unanswered permission or plan
      card in an ACP/SDK live turn, or an unanswered PTY hook prompt (see
      `collectPendingInputSessions`). */
  listPendingInputSessions: async () => {
    return ok({ sessions: collectPendingInputSessions(listActiveSessions()) });
  },

  ...chatControlProcedures,

  getAll: async (workItemId: string) => {
    const rows = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.workItemId, workItemId))
      .orderBy(asc(agentSessions.createdAt));
    return ok({ sessions: rows });
  },

  /**
   * Message count and preview line for every session of one work item — what
   * the Work item map's session rows show beyond their own columns. One
   * statement for all of them; see session-row-summaries.ts.
   */
  getRowSummaries: (workItemId: string) => {
    return ok({ summaries: readSessionRowSummaries(workItemId) });
  },

  create: async (args: {
    workItemId: string;
    kind: 'chat' | 'terminal';
    agentProviderId?: string;
    communication?: 'acp' | 'pty';
    externalSessionId?: string;
    title?: string;
    worktreeId?: string;
  }) => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, args.workItemId))
      .limit(1);
    if (!item) return err({ type: 'not_found' as const });

    const worktree = resolveCreateWorktree(args.workItemId, args.worktreeId);
    if (!worktree.ok) return err(worktree.error);

    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await db.insert(agentSessions).values({
      id,
      workItemId: args.workItemId,
      kind: args.kind,
      agentProviderId: args.agentProviderId ?? null,
      communication: args.communication ?? 'pty',
      externalSessionId: args.externalSessionId ?? null,
      title: args.title ?? null,
      cwd: worktree.row.path,
      worktreeId: worktree.row.id,
      status: 'active',
      createdAt: now,
      lastActiveAt: now,
    });

    // After the insert, not before: the push reads the table, so scheduling
    // it first would only ever publish the pre-insert set if the debounce
    // somehow fired early. Only chat sessions reach the registry, so
    // createShellTerminal below deliberately schedules nothing.
    scheduleSessionCloudSync(args.workItemId);
    // A chat row exists before its agent starts (on its first message).
    announceSessionsChanged(args.workItemId);

    const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1);
    return ok({ session: row });
  },

  /** A plain shell terminal (`rpc.terminalShells.list` ids) in a worktree. */
  createShellTerminal: async (args: { workItemId: string; shell: string; worktreeId?: string }) => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, args.workItemId))
      .limit(1);
    if (!item) return err({ type: 'not_found' as const });
    if (item.provisionStatus !== 'ready') {
      return err({ type: 'workspace_not_ready' as const, provisionStatus: item.provisionStatus });
    }
    const worktree = resolveCreateWorktree(args.workItemId, args.worktreeId);
    if (!worktree.ok) return err(worktree.error);
    return createShellTerminalSession({
      workItemId: args.workItemId,
      worktree: worktree.row,
      shellId: args.shell,
    });
  },

  /** An agent CLI in a terminal, e.g. `claude --resume <id>` from the session list. */
  createTerminal: async (args: {
    workItemId: string;
    agentProviderId?: string;
    /** Resume an existing CLI session in this terminal (e.g. `claude --resume <id>`). */
    resumeExternalSessionId?: string;
    worktreeId?: string;
  }) => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, args.workItemId))
      .limit(1);
    if (!item) return err({ type: 'not_found' as const });
    // Pre-worktree, repoPath is the shared repo root — the isolation gate
    // (see work-item-crud provisioning) lives at execution, not creation.
    if (item.provisionStatus !== 'ready') {
      return err({ type: 'workspace_not_ready' as const, provisionStatus: item.provisionStatus });
    }

    const worktree = resolveCreateWorktree(args.workItemId, args.worktreeId);
    if (!worktree.ok) return err(worktree.error);

    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const requestedProvider = args.agentProviderId ?? item.agentProvider;
    if (!isValidProviderId(requestedProvider)) {
      return err({ type: 'no_agent_provider' as const });
    }
    const providerId: AgentProviderId = requestedProvider;
    const cwd = resolve(worktree.row.path);

    // Refuse to open a terminal that would immediately die with the CLI's
    // "No conversation found" — the id must have a persisted conversation.
    if (
      args.resumeExternalSessionId &&
      providerId === 'claude' &&
      !claudeConversationExists(cwd, args.resumeExternalSessionId)
    ) {
      return err({ type: 'conversation_not_found' as const });
    }

    await db.insert(agentSessions).values({
      id,
      workItemId: args.workItemId,
      kind: 'terminal',
      agentProviderId: providerId,
      communication: 'pty',
      externalSessionId: args.resumeExternalSessionId ?? null,
      cwd,
      worktreeId: worktree.row.id,
      status: 'active',
      createdAt: now,
      lastActiveAt: now,
    });

    await startSession(id, args.workItemId, {
      cwd,
      providerId,
      kind: 'terminal',
      isResuming: args.resumeExternalSessionId !== undefined,
      externalSessionId: args.resumeExternalSessionId,
      taskEnvVars: await resolveSessionLaneEnv(id),
    });

    const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1);
    return ok({ session: row });
  },

  resume: (sessionId: string) => resumeAgentSession(sessionId),

  markDone: async (sessionId: string) => {
    await stopSession(sessionId);

    // stopSession only suspends the row (and no-ops entirely when the session
    // isn't live); 'done' is what removes it from the session tab strip.
    await db
      .update(agentSessions)
      .set({ status: 'done', lastActiveAt: Math.floor(Date.now() / 1000) })
      .where(eq(agentSessions.id, sessionId));
    forgetEndedSession(sessionId);

    const [row] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);
    if (row) {
      scheduleSessionCloudSync(row.workItemId);
      announceSessionsChanged(row.workItemId);
    }
    return ok({ session: row });
  },

  update: async (args: {
    id: string;
    title?: string;
    status?: string;
    externalSessionId?: string;
  }) => {
    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { lastActiveAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.status !== undefined) updates.status = args.status;
    if (args.externalSessionId !== undefined) updates.externalSessionId = args.externalSessionId;

    await db.update(agentSessions).set(updates).where(eq(agentSessions.id, args.id));
    if (args.status === 'done') forgetEndedSession(args.id);
    const [row] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, args.id))
      .limit(1);
    // Title and status are both published — a rename or an end must reach a
    // participant's tab strip, not just the owner's.
    if (row) {
      scheduleSessionCloudSync(row.workItemId);
      announceSessionsChanged(row.workItemId);
    }
    return ok({ session: row });
  },

  remove: async (id: string) => {
    // Read the owner work item BEFORE the delete — afterwards there is no row
    // to learn it from, and the registry would keep advertising a thread that
    // no longer exists.
    const [row] = await db
      .select({ workItemId: agentSessions.workItemId })
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .limit(1);
    await db.delete(agentSessions).where(eq(agentSessions.id, id));
    forgetEndedSession(id);
    if (row) {
      scheduleSessionCloudSync(row.workItemId);
      announceSessionsChanged(row.workItemId);
    }
    return ok();
  },

  touch: async (id: string) => {
    const now = Math.floor(Date.now() / 1000);
    await db.update(agentSessions).set({ lastActiveAt: now }).where(eq(agentSessions.id, id));
    return ok();
  },
});
