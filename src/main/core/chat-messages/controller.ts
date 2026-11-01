import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { resolveTurnAgentName } from '@shared/agent-display-name';
import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { likeContains } from '@main/core/utils/sql-like';
import { getPrimaryWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, chatMessages, workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { requireCreatedAtMs } from './chat-row-time';
import { postMessageToThread } from './post-to-thread';
import { sendMessageToAgent } from './send-to-agent';

// `chat_messages.sender_type`: 'human' | 'agent' | 'system'.
// `chat_messages.message_type`: 'text' | 'code' | 'system' | 'commit' | 'agent_turn'.

export const chatMessagesController = createRPCController({
  /**
   * One thread's messages, or the whole work item's when no session is named.
   *
   * A thread also carries the rows that belong to no session: chat from before
   * threads existed, and participant rows synced by a client too old to stamp
   * `session_id`. No single thread owns them, and the tab of a session that
   * ended is dropped, so anything left in one thread alone would become
   * unreachable. The renderer dims them as work-item history.
   *
   * This set is still GROWING: the WS chat event carries no session field at
   * all (`packages/protocol/src/ws-events.ts`), so every participant send
   * lands here. It freezes only once participant clients can name a thread,
   * which needs the cloud session registry that does not exist yet
   * (`server/src/db/schema.ts` says the same about its own session_id).
   *
   * `withoutTurns` leaves out `agent_turn` rows: a thread renders its turns
   * from `getTimelineTurns`, and these rows carry every tool call and output
   * of every turn — most of what a long thread's read weighs.
   */
  getMessages: async (
    workItemId: string,
    opts?: { sessionId?: string; withoutTurns?: boolean }
  ) => {
    const conditions = [eq(chatMessages.workItemId, workItemId)];
    if (opts?.withoutTurns) conditions.push(ne(chatMessages.messageType, 'agent_turn'));
    if (opts?.sessionId) {
      conditions.push(
        or(eq(chatMessages.sessionId, opts.sessionId), isNull(chatMessages.sessionId))!
      );
    }
    const rows = await db
      .select()
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(asc(chatMessages.createdAtMs));
    return ok({ messages: rows.map((row) => ({ ...row, createdAtMs: requireCreatedAtMs(row) })) });
  },

  /**
   * One message of the work item, or null when this machine has no copy: what
   * a notification click reveals (shared-items step 5). The caller reads the
   * cloud when it is not here.
   */
  getMessage: async (workItemId: string, messageId: string) => {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(and(eq(chatMessages.workItemId, workItemId), eq(chatMessages.id, messageId)))
      .limit(1);
    return ok({ message: row ?? null });
  },

  /**
   * The prompt this work item started from — its brief.
   *
   * A dedicated read rather than `getMessages().at(0)`: the rail shows this on
   * every work item, and loading a whole transcript to display three lines of
   * it is exactly the kind of read that gets expensive on a long-lived work
   * item without ever looking like it did.
   */
  getFirstHumanMessage: async (workItemId: string) => {
    const [row] = await db
      .select({ content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.workItemId, workItemId), eq(chatMessages.senderType, 'human')))
      .orderBy(asc(chatMessages.createdAtMs))
      .limit(1);
    return ok({ content: row?.content ?? null });
  },

  searchAll: (args: { query: string; limit?: number }) => {
    const rows = db
      .select({
        id: chatMessages.id,
        workItemId: chatMessages.workItemId,
        content: chatMessages.content,
        senderName: chatMessages.senderName,
        senderType: chatMessages.senderType,
        createdAt: chatMessages.createdAt,
        workItemName: workItems.name,
      })
      .from(chatMessages)
      .leftJoin(workItems, eq(chatMessages.workItemId, workItems.id))
      .where(likeContains(chatMessages.content, args.query))
      .orderBy(desc(chatMessages.createdAtMs))
      .limit(args.limit ?? 10)
      .all();
    return ok({ messages: rows });
  },

  sendToAgent: (args: {
    workItemId: string;
    content: string;
    senderName?: string;
    sessionId?: string;
    agentProviderId?: string;
  }) => sendMessageToAgent(args),

  /** A message addressed to people only: saved in its thread, no agent turn. */
  postToThread: (args: {
    workItemId: string;
    sessionId: string;
    content: string;
    senderName?: string;
  }) => postMessageToThread(args),

  getTimelineTurns: async (args: {
    workItemId: string;
    afterTimestamp?: number;
    sessionId?: string;
    worktreeId?: string;
  }) => {
    // A worktree has no direct session_id column to filter by — it's mapped
    // via agent_sessions rows scoped to that worktree (a null worktree_id
    // counts as the primary, same rule as resolveSessionWorktreeRow).
    let sessionIdFilter: string[] | undefined;
    if (args.sessionId) {
      sessionIdFilter = [args.sessionId];
    } else if (args.worktreeId) {
      const isPrimary = getPrimaryWorktreeRow(args.workItemId).id === args.worktreeId;
      const sessionRows = await db
        .select({ id: agentSessions.id, worktreeId: agentSessions.worktreeId })
        .from(agentSessions)
        .where(eq(agentSessions.workItemId, args.workItemId));
      sessionIdFilter = sessionRows
        .filter((s) => s.worktreeId === args.worktreeId || (isPrimary && s.worktreeId === null))
        .map((s) => s.id);
    }
    if (sessionIdFilter && sessionIdFilter.length === 0) {
      return ok({ turns: [] });
    }

    const conditions = [
      eq(chatMessages.workItemId, args.workItemId),
      eq(chatMessages.messageType, 'agent_turn'),
    ];
    if (sessionIdFilter) conditions.push(inArray(chatMessages.sessionId, sessionIdFilter));

    // The session's provider names the turn: rows persisted before bridges
    // carried the provider name were stored as "Chord Agent".
    const joined = await db
      .select({ message: chatMessages, sessionProviderId: agentSessions.agentProviderId })
      .from(chatMessages)
      .leftJoin(agentSessions, eq(chatMessages.sessionId, agentSessions.id))
      .where(and(...conditions))
      .orderBy(asc(chatMessages.createdAtMs));

    const turns: Array<{
      turnId: string;
      agentName: string;
      items: unknown[];
      timestamp: number;
      status: 'complete' | 'streaming';
      startedAt?: number;
      completedAt?: number;
      usage?: { inputTokens?: number; outputTokens?: number; totalCostUsd?: number };
      sessionId?: string;
      historyRef?: string;
    }> = [];

    for (const { message: row, sessionProviderId } of joined) {
      if (args.afterTimestamp && row.createdAt <= args.afterTimestamp) continue;
      try {
        const meta = JSON.parse(row.metadata ?? '{}');
        if (meta.turnId && meta.items) {
          turns.push({
            turnId: meta.turnId,
            agentName: resolveTurnAgentName({ sessionProviderId, senderName: row.senderName }),
            items: meta.items,
            timestamp: row.createdAt,
            status: 'complete',
            startedAt: meta.startedAt,
            completedAt: meta.completedAt,
            usage: meta.usage,
            sessionId: row.sessionId ?? undefined,
            historyRef: row.historyRef ?? undefined,
          });
        }
      } catch {
        /* skip malformed */
      }
    }

    // The in-flight turn lives only in the session bridge until completeTurn
    // persists it — without it, a consumer that mounts mid-stream has no way
    // to recover the items emitted before it subscribed.
    try {
      const { getActiveSessions } = await import('@main/core/work-items/active-sessions');
      for (const session of getActiveSessions(args.workItemId)) {
        if (session.kind !== 'chat' || !session.bridge) continue;
        if (sessionIdFilter && !sessionIdFilter.includes(session.sessionId)) continue;
        const live = session.bridge.getLiveTurnSnapshot();
        if (live && !turns.some((t) => t.turnId === live.turnId)) {
          turns.push({ ...live, sessionId: session.sessionId, status: 'streaming' });
        }
      }
    } catch (e) {
      log.warn('getTimelineTurns: failed to read live turn snapshot', { error: String(e) });
    }

    return ok({ turns });
  },

  stopAgent: async (workItemId: string, opts?: { sessionId?: string }) => {
    try {
      const sessionService = await import('@main/core/work-items/session-service');
      const { getActiveSessions } = await import('@main/core/work-items/active-sessions');
      if (opts?.sessionId) {
        await sessionService.stopSession(opts.sessionId);
      } else {
        const sessions = getActiveSessions(workItemId);
        for (const s of sessions) {
          await sessionService.stopSession(s.sessionId);
        }
      }
    } catch (e) {
      log.warn('stopAgent: failed', { error: String(e) });
    }
    return ok();
  },
});
