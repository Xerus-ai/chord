import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { isPublishToolAvailable } from '@main/core/agent-artifact-tools/artifact-tool-availability';
import { getAgentControlCatalog } from '@main/core/agent-catalog/catalog-service';
import { claudeConversationExists } from '@main/core/agent-sessions/claude-conversation-store';
import { forgetEndedSession } from '@main/core/agent-sessions/forget-ended-session';
import {
  launchConfigChanged,
  resolveChatLaunchConfig,
} from '@main/core/agent-sessions/session-config-store';
import { prependPlatformContext } from '@main/core/artifacts/platform-instructions';
import type * as ActiveSessions from '@main/core/work-items/active-sessions';
import type * as SessionService from '@main/core/work-items/session-service';
import type * as SessionTaskEnv from '@main/core/work-items/session-task-env';
import { laneSessionCwd, resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { agentSessions, type AgentSessionRow, type workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { noteMessageDelivered } from './note-message-delivered';
import {
  findResumableChatRow,
  resolveNewChatSessionWorktree,
  resolveTargetSessionCwd,
} from './resolve-chat-session';
import { runExclusivePerSession, runExclusivePerWorkItem } from './send-locks';
import type { ThreadDigest } from './thread-digest';

/** Thrown to signal `worktree_archived` out of a deep, lock-scoped callback
    without smuggling the type through a generic Error message string. */
export class WorktreeArchivedError extends Error {
  constructor(sessionId: string) {
    super(`Worktree for session ${sessionId} is archived`);
    this.name = 'WorktreeArchivedError';
  }
}

/** The session lifecycle, the live-session registry and task env, loaded lazily (import cycle). */
export type SessionServiceModule = typeof SessionService &
  typeof ActiveSessions &
  typeof SessionTaskEnv;
export type ActiveSession = ActiveSessions.ActiveSession;
export type WorkItemRow = typeof workItems.$inferSelect;

/**
 * Sends to a session that already has a live process. Returns whether the
 * message was actually delivered — `false` means the session's provider or
 * model/effort selection changed underneath it and it was stopped instead;
 * the caller must then resume/restart it via the DB row.
 */
export async function deliverToLiveSession(
  sessionService: SessionServiceModule,
  active: ActiveSession,
  providerId: AgentProviderId,
  item: WorkItemRow,
  digest: ThreadDigest,
  content: string,
  isSlashCommand: boolean
): Promise<boolean> {
  const providerChanged = active.providerId !== providerId;
  // Compared against the session's own selection (work item as fallback), so
  // a model picked in one session tab never restarts a sibling session.
  const configChanged = launchConfigChanged(
    active.launch,
    resolveChatLaunchConfig(
      await getAgentControlCatalog(providerId, active.sessionId),
      item,
      active.sessionId
    )
  );

  if (providerChanged || configChanged) {
    log.info('sendToAgent: session config changed, restarting chat session', {
      workItemId: item.id,
      sessionId: active.sessionId,
      providerChanged,
      fromProvider: active.providerId,
      toProvider: providerId,
    });
    await sessionService.stopSession(active.sessionId);
    return false;
  }

  const sent = sessionService.sendInput(
    active.sessionId,
    isSlashCommand ? content : digest.wrap(content)
  );
  if (sent && !isSlashCommand) digest.commit();
  log.info('sendToAgent: sent to existing chat session', {
    workItemId: item.id,
    sessionId: active.sessionId,
    sent,
  });
  return sent;
}

/**
 * Delivers to whichever chat session the explicit `sessionId` names — live
 * (send directly, restarting on a config change) or suspended (resume that
 * exact row in its own worktree). Locked per SESSION id: two sends to the
 * same suspended session must not both start a process for it, but a send to
 * a DIFFERENT session on the same work item must not wait behind it.
 */
export async function deliverToTargetSession(
  sessionService: SessionServiceModule,
  targetRow: AgentSessionRow,
  providerId: AgentProviderId,
  item: WorkItemRow,
  digest: ThreadDigest,
  content: string,
  isSlashCommand: boolean
): Promise<void> {
  const live = sessionService.getActiveSession(targetRow.id);
  if (live) {
    const sent = await deliverToLiveSession(
      sessionService,
      live,
      providerId,
      item,
      digest,
      content,
      isSlashCommand
    );
    if (sent) return;
  }

  await runExclusivePerSession(targetRow.id, async () => {
    // Re-check under the lock: a concurrent call (or the stop above) may
    // already have a fresh process running for this session id.
    const nowLive = sessionService.getActiveSession(targetRow.id);
    if (nowLive) {
      const sent = sessionService.sendInput(
        targetRow.id,
        isSlashCommand ? content : digest.wrap(content)
      );
      if (sent && !isSlashCommand) digest.commit();
      return;
    }

    const cwdResult = resolveTargetSessionCwd(targetRow.id);
    if (!cwdResult.success) throw new WorktreeArchivedError(targetRow.id);
    const cwd = cwdResult.data;

    const enrichedPrompt = isSlashCommand
      ? content
      : prependPlatformContext(digest.wrap(content), {
          publishToolAvailable: await isPublishToolAvailable(providerId),
        });

    const now = Math.floor(Date.now() / 1000);
    log.info('sendToAgent: resuming explicitly targeted chat session', {
      workItemId: item.id,
      sessionId: targetRow.id,
    });
    await db
      .update(agentSessions)
      .set({ status: 'active', lastActiveAt: now })
      .where(eq(agentSessions.id, targetRow.id));

    await sessionService.startSession(targetRow.id, item.id, {
      cwd,
      providerId,
      kind: 'chat',
      initialPrompt: enrichedPrompt,
      isResuming: targetRow.externalSessionId != null,
      externalSessionId: targetRow.externalSessionId ?? undefined,
      taskEnvVars: await sessionService.resolveSessionLaneEnv(targetRow.id),
    });
    if (!isSlashCommand) digest.commit();
  });
}

/** A resumed row's cwd comes from ITS OWN worktree, never the work item's primary. */
function resumableRowCwd(sessionId: string): string {
  return laneSessionCwd(resolveSessionWorktreeRow(sessionId));
}

/**
 * The default (no explicit session) path: resume the newest suspended chat
 * row for the provider, or mint a brand-new one in the work item's primary
 * worktree. Locked per WORK ITEM: two concurrent first-sends must not each
 * mint a session and spawn two agents on one repo. Callers must already have
 * checked there is no live chat session before calling this.
 *
 * `messageId` is the saved prompt. It was stored with no session when none was
 * running, and is tied here to the session it reaches (`noteMessageDelivered`).
 */
export async function deliverToDefaultSession(
  sessionService: SessionServiceModule,
  workItemId: string,
  providerId: AgentProviderId,
  digest: ThreadDigest,
  content: string,
  isSlashCommand: boolean,
  messageId: string
): Promise<void> {
  await runExclusivePerWorkItem(workItemId, async () => {
    // Re-check under the lock: a concurrent first-send may have established
    // the chat session while we awaited our turn.
    const nowActive = sessionService.getActiveSessions(workItemId).find((s) => s.kind === 'chat');
    if (nowActive) {
      const delivered = sessionService.sendInput(
        nowActive.sessionId,
        isSlashCommand ? content : digest.wrap(content)
      );
      if (delivered) {
        await noteMessageDelivered({
          workItemId,
          messageId,
          sessionId: nowActive.sessionId,
          content,
          isSlashCommand,
        });
      }
      if (delivered && !isSlashCommand) digest.commit();
      return;
    }

    const enrichedPrompt = isSlashCommand
      ? content
      : prependPlatformContext(digest.wrap(content), {
          publishToolAvailable: await isPublishToolAvailable(providerId),
        });
    const now = Math.floor(Date.now() / 1000);

    // One logical conversation = one row. A cold start (app restart, SDK
    // exit, model change) resumes the newest suspended chat row instead of
    // minting a new row per start — the conversation continues via the
    // row's external session id, so the row must continue too.
    let resumable = await findResumableChatRow(workItemId, providerId);
    let cwd = resumable ? resumableRowCwd(resumable.id) : undefined;

    // A claude id that was reserved but never persisted a conversation
    // (crash after onSessionId, before the first exchange) cannot resume —
    // same guard as the terminal paths in agent-sessions/controller. The
    // dangling row is retired so it stops shadowing fresh starts.
    if (
      resumable &&
      cwd &&
      providerId === 'claude' &&
      !claudeConversationExists(cwd, resumable.externalSessionId as string)
    ) {
      log.info('sendToAgent: retiring chat row with unresumable external id', {
        workItemId,
        sessionId: resumable.id,
      });
      await db
        .update(agentSessions)
        .set({ status: 'done', lastActiveAt: now })
        .where(eq(agentSessions.id, resumable.id));
      forgetEndedSession(resumable.id);
      resumable = undefined;
      cwd = undefined;
    }

    let dbSessionId: string;
    if (resumable && cwd) {
      dbSessionId = resumable.id;
      log.info('sendToAgent: resuming suspended chat session', {
        workItemId,
        sessionId: dbSessionId,
      });
      await db
        .update(agentSessions)
        .set({ status: 'active', lastActiveAt: now })
        .where(eq(agentSessions.id, dbSessionId));
    } else {
      dbSessionId = randomUUID();
      const { worktreeId, cwd: primaryCwd } = resolveNewChatSessionWorktree(workItemId);
      cwd = primaryCwd;
      log.info('sendToAgent: starting NEW chat session', { workItemId });
      await db.insert(agentSessions).values({
        id: dbSessionId,
        workItemId,
        kind: 'chat',
        agentProviderId: providerId,
        communication: 'pty',
        title: content.trim().slice(0, 120),
        cwd,
        worktreeId,
        status: 'active',
        createdAt: now,
        lastActiveAt: now,
      });
    }

    await sessionService.startSession(dbSessionId, workItemId, {
      cwd,
      providerId,
      kind: 'chat',
      initialPrompt: enrichedPrompt,
      isResuming: resumable !== undefined,
      externalSessionId: resumable?.externalSessionId ?? undefined,
      taskEnvVars: await sessionService.resolveSessionLaneEnv(dbSessionId),
    });
    await noteMessageDelivered({
      workItemId,
      messageId,
      sessionId: dbSessionId,
      content,
      isSlashCommand,
    });
    if (!isSlashCommand) digest.commit();
  });
}
