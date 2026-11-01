import { eq } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { err, ok, type Result } from '@shared/result';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { LaneWaitCancelledError, waitForLane } from '@main/core/worktrees/lane-readiness';
import {
  getPrimaryWorktreeRow,
  resolveSessionWorktreeRow,
} from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import {
  agentSessions,
  workItems,
  type AgentSessionRow,
  type WorkItemRow,
} from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import {
  deliverToDefaultSession,
  deliverToLiveSession,
  deliverToTargetSession,
  WorktreeArchivedError,
  type ActiveSession,
  type SessionServiceModule,
} from './deliver-to-session';
import { insertChatMessageRow } from './insert-chat-message-row';
import { noteMessageDelivered } from './note-message-delivered';
import { resolveSendProvider } from './resolve-send-provider';
import { decideSendReadiness } from './send-readiness';
import { buildThreadDigest } from './thread-digest';
import { validateTargetSession } from './validate-target-session';

type DeliveryError =
  | { type: 'worktree_archived'; message: string; messageId: string }
  | { type: 'agent_start_failed'; message: string; messageId: string };

async function loadSessionService(): Promise<SessionServiceModule> {
  return {
    ...(await import('@main/core/work-items/session-service')),
    ...(await import('@main/core/work-items/active-sessions')),
    ...(await import('@main/core/work-items/session-task-env')),
  };
}

/**
 * Hands a saved message to its agent: the explicitly targeted session, else
 * the work item's live chat session, else a resumed or new one. Failure to
 * reach an agent is returned, never swallowed — the message row survives, but
 * the caller must be told nothing is listening.
 */
async function deliverMessage(args: {
  sessionService: SessionServiceModule;
  item: WorkItemRow;
  targetRow: AgentSessionRow | undefined;
  defaultChatSession: ActiveSession | undefined;
  providerId: AgentProviderId;
  messageId: string;
  threadSessionId: string | null;
  content: string;
  isSlashCommand: boolean;
}): Promise<Result<void, DeliveryError>> {
  const { sessionService, item, targetRow, providerId, isSlashCommand } = args;
  try {
    // Every prompt entering a session carries that thread's digest — messages
    // that landed while the agent was busy or away, prompt-prefix only, never
    // history. The just-inserted row is the prompt itself, so it is excluded;
    // the cursor advances only once the prompt actually reaches a session.
    const digest = buildThreadDigest(item.id, args.threadSessionId ?? '', [args.messageId]);

    const delivered = (sessionId: string) =>
      noteMessageDelivered({
        workItemId: item.id,
        messageId: args.messageId,
        sessionId,
        content: args.content,
        isSlashCommand,
      });

    if (targetRow) {
      await deliverToTargetSession(
        sessionService,
        targetRow,
        providerId,
        item,
        digest,
        args.content,
        isSlashCommand
      );
      await delivered(targetRow.id);
      return ok();
    }

    let sent = false;
    if (args.defaultChatSession) {
      sent = await deliverToLiveSession(
        sessionService,
        args.defaultChatSession,
        providerId,
        item,
        digest,
        args.content,
        isSlashCommand
      );
      if (sent) await delivered(args.defaultChatSession.sessionId);
    }
    if (!sent) {
      await deliverToDefaultSession(
        sessionService,
        item.id,
        providerId,
        digest,
        args.content,
        isSlashCommand,
        args.messageId
      );
    }
    return ok();
  } catch (e) {
    if (e instanceof WorktreeArchivedError) {
      return err({
        type: 'worktree_archived' as const,
        message: e.message,
        messageId: args.messageId,
      });
    }
    const message = String((e as Error)?.message || e);
    log.error('sendToAgent: agent session failed to start (message saved)', {
      workItemId: item.id,
      messageId: args.messageId,
      error: message,
    });
    return err({ type: 'agent_start_failed' as const, message, messageId: args.messageId });
  }
}

/**
 * Saves a user message and delivers it to the work item's chat agent,
 * starting or resuming the session when none is live.
 *
 * With `sessionId`, the message targets that specific chat session instead
 * of "whichever chat session is live" — see `deliverToTargetSession`.
 *
 * A message sent before its lane is ready (the checkout still being created,
 * or setup still running with `agentStart: waitForSetup`) is saved now and
 * delivered once the lane is ready; the result then says `deferred`.
 */
export async function sendMessageToAgent(args: {
  workItemId: string;
  content: string;
  senderName?: string;
  sessionId?: string;
  /** The agent the sending composer shows; used when no session is targeted. */
  agentProviderId?: string;
}) {
  const [item] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, args.workItemId))
    .limit(1);
  if (!item) {
    return err({ type: 'not_found' as const });
  }

  let targetRow: AgentSessionRow | undefined;
  if (args.sessionId) {
    const [row] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, args.sessionId))
      .limit(1);
    const validated = validateTargetSession(row, args.workItemId);
    if (!validated.success) return validated;
    targetRow = validated.data;
  }

  // The lane the message will run in: the targeted session's, else the
  // primary, where a new or resumed default session starts.
  const lane = targetRow
    ? resolveSessionWorktreeRow(targetRow.id)
    : getPrimaryWorktreeRow(args.workItemId);
  const readiness = decideSendReadiness({
    provisionStatus: item.provisionStatus,
    setupStatus: lane.setupStatus,
    agentStart: readJustMeSettings(item.repoId).agentStart ?? 'waitForSetup',
  });
  if (readiness.kind === 'refuse') {
    return err({ type: 'workspace_not_ready' as const, provisionStatus: item.provisionStatus });
  }

  const providerId = resolveSendProvider({
    targetRowProvider: targetRow?.agentProviderId,
    requestedProvider: args.agentProviderId,
    itemProvider: item.agentProvider,
  });
  if (!providerId) {
    return err({ type: 'no_agent_provider' as const });
  }

  // A leading slash is an agent command (custom command / skill). It only
  // executes if it is the very START of the delivered message, so it must
  // never be wrapped by the room digest or platform context. Marked
  // agent_prompt so an undelivered digest cursor can't replay it later as a
  // "room message".
  const isSlashCommand = /^\/[A-Za-z0-9]/.test(args.content.trim());
  const metadata = isSlashCommand ? JSON.stringify({ agent_prompt: true }) : '{}';

  const sessionService = await loadSessionService();

  // Default path only: best-effort so a session lookup failure never blocks
  // the message row itself. The explicit-session path already validated its
  // target above, so it does not need this fallback.
  let defaultChatSession: ActiveSession | undefined;
  if (!targetRow) {
    try {
      defaultChatSession = sessionService
        .getActiveSessions(args.workItemId)
        .filter((s) => s.kind === 'chat')[0];
    } catch {
      /* session lookup is best-effort for sessionId tagging */
    }
  }

  // The thread this message belongs to: the explicitly targeted session, else
  // the work item's live chat session. Null only when nothing is running, in
  // which case the row is stored and no digest is built — there is no thread
  // to catch up.
  const threadSessionId = targetRow?.id ?? defaultChatSession?.sessionId ?? null;

  const { id } = await insertChatMessageRow({
    workItemId: args.workItemId,
    content: args.content,
    sessionId: threadSessionId,
    metadata,
    senderName: args.senderName,
  });

  const delivery = {
    sessionService,
    item,
    targetRow,
    providerId,
    messageId: id,
    threadSessionId,
    content: args.content,
    isSlashCommand,
  };

  if (readiness.kind === 'wait') {
    waitForLane(lane.id, readiness.until)
      .then(async () => {
        // Re-read: the item's path moved to the checkout while we waited.
        const [ready] = await db
          .select()
          .from(workItems)
          .where(eq(workItems.id, args.workItemId))
          .limit(1);
        if (!ready) return;
        const result = await deliverMessage({
          ...delivery,
          item: ready,
          defaultChatSession: undefined,
        });
        if (!result.success) {
          log.error('sendToAgent: deferred message could not reach an agent', {
            workItemId: args.workItemId,
            messageId: id,
            error: result.error.message,
          });
        }
      })
      .catch((error) => {
        if (error instanceof LaneWaitCancelledError) return;
        log.error('sendToAgent: deferred delivery failed', {
          workItemId: args.workItemId,
          messageId: id,
          error: String(error),
        });
      });
    return ok({ messageId: id, deferred: true as const });
  }

  const result = await deliverMessage({ ...delivery, defaultChatSession });
  if (!result.success) return result;
  return ok({ messageId: id, deferred: false as const });
}
