import { existsSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import type { TerminalShell } from '@shared/terminal-shells';
import { getAcpConnection } from '@main/core/acp/acp-session-store';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { SessionSupervisor } from '@main/core/agent-sessions/session-supervisor';
import { clearSessionEpoch, resetSessionEpoch } from '@main/core/chat-messages/stream-turn-items';
import { permissionPublicationService } from '@main/core/commands/permission-publication-service';
import { planPublicationService } from '@main/core/commands/plan-publication-service';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { agentSessions, workItems } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import {
  getActiveSession,
  hasOtherChatSession,
  listActiveSessions,
  registerActiveSession,
  unregisterActiveSession,
} from './active-sessions';
import { restoreChatResumeState } from './chat-resume-state';
import {
  launchSessionTransport,
  resolveTransport,
  type StartSessionOptions,
} from './launch-session-transport';
import { launchShellProcess } from './launch-shell-session';
import { markSessionLaunched } from './mark-session-launched';
import { reconcileSessionsOnStartup } from './reconcile-sessions-on-startup';
import { notifySessionExited } from './session-exit-waiters';
import { resolveSessionLaneEnv } from './session-task-env';
import { teardownSession } from './session-teardown';

const supervisor = new SessionSupervisor();

const RESPAWN_DELAY_MS = 500;

function suspendDbSession(sessionId: string): void {
  const now = Math.floor(Date.now() / 1000);
  db.update(agentSessions)
    .set({ status: 'suspended', lastActiveAt: now })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function removeSession(sessionId: string): void {
  const session = unregisterActiveSession(sessionId);
  if (!session) return;
  suspendDbSession(sessionId);
  // ...and every session-end path funnels through here. Suspension is
  // published too: a participant should see the thread go quiet rather than
  // keep addressing an agent that is no longer listening.
  scheduleSessionCloudSync(session.workItemId);
  // Every session-end path (stop, crash, exit-then-respawn) funnels through
  // here: permission requests this session published can never be answered
  // now, so their cloud cards are retracted as expired (design §4). A
  // respawn-resume starts a fresh query — the old requestIds die with the
  // process either way.
  permissionPublicationService.expireForSession(sessionId);
  // Same for a plan card this session left awaiting approval — otherwise a
  // shared participant keeps a live Approve/Reject card that can never resolve.
  planPublicationService.expireForSession(sessionId);
}

export function initializeSessions(): void {
  restoreChatResumeState(reconcileSessionsOnStartup());
}

function handleSessionExit(
  sessionId: string,
  workItemId: string,
  providerId: AgentProviderId | null,
  kind: 'chat' | 'terminal',
  exitCode: number | undefined,
  cwd: string,
  externalSessionId?: string
): void {
  // First, whatever the supervisor decides: a stopped session's exit is what
  // a checkout removal is waiting for (stop-checkout-sessions.ts).
  notifySessionExited(sessionId);
  const transport = supervisor.getTransport(sessionId);
  const decision = supervisor.handleExit(sessionId);
  if (decision.kind === 'stale') return;

  removeSession(sessionId);
  capture('agent_run_finished', {
    provider: providerId,
    exit_code: typeof exitCode === 'number' ? exitCode : -1,
  });

  if (decision.kind === 'stopped') return;

  events.emit(agentSessionExitedChannel, {
    sessionId,
    workItemId,
    conversationId: sessionId,
    taskId: workItemId,
    exitCode,
  });

  // The structured transports (a claude-sdk query, a codex app-server thread)
  // are long-lived: they exit only when closed or when the process dies.
  // Respawning here would start without a pending user input to answer; the
  // next user message starts a fresh one that resumes via the persisted
  // external_session_id instead.
  if (transport === 'claude-sdk' || transport === 'codex-app-server') {
    supervisor.stop(sessionId);
    return;
  }

  // A terminal exiting is the user ending the CLI (typing `exit`, Ctrl-D, or
  // the process dying in front of them). Respawning would make the terminal
  // impossible to leave; the session stays suspended and resumable instead.
  if (kind === 'terminal') {
    supervisor.stop(sessionId);
    return;
  }

  if (supervisor.isDesired(sessionId) && providerId) {
    scheduleRespawn(sessionId, {
      workItemId,
      cwd,
      providerId,
      kind,
      isResuming: decision.kind === 'respawnResume',
      externalSessionId,
    });
  }
}

export async function startSession(
  sessionId: string,
  workItemId: string,
  opts: StartSessionOptions
): Promise<string> {
  const transport = resolveTransport(opts.providerId, opts.kind);
  // The event epoch orders the work item's chat turn stream; a terminal
  // starting must not reset it mid-stream — nor may a second chat session
  // while a sibling session in the same work item is streaming.
  if (opts.kind === 'chat' && !hasOtherChatSession(workItemId, sessionId)) {
    resetSessionEpoch(workItemId);
  }

  const spawnToken = supervisor.beginStart(sessionId, {
    mode: opts.isResuming ? 'resume' : 'fresh',
    transport,
  });
  if (!spawnToken) {
    log.info('session-service: concurrent start blocked', { sessionId });
    return sessionId;
  }

  try {
    db.update(workItems)
      .set({ agentProvider: opts.providerId, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(workItems.id, workItemId))
      .run();
  } catch {
    log.debug('session-service: failed to update agent_provider', { workItemId });
  }

  const callbacks = {
    onExit: (exitCode: number | undefined) => {
      handleSessionExit(
        sessionId,
        workItemId,
        opts.providerId,
        opts.kind,
        exitCode,
        opts.cwd,
        opts.externalSessionId
      );
    },
  };

  try {
    const session = await launchSessionTransport(transport, sessionId, workItemId, opts, callbacks);
    registerActiveSession(session);

    if (!supervisor.acceptSpawn(sessionId, spawnToken)) {
      log.info('session-service: stop landed during spawn, tearing down', { sessionId });
      await teardownSession(session, { isOrphaned: true });
      removeSession(sessionId);
      return sessionId;
    }

    markSessionLaunched(sessionId, transport);
    capture('agent_run_started', { provider: opts.providerId });
    log.info('session-service: started', { sessionId, providerId: opts.providerId, transport });

    if (opts.kind === 'chat') {
      // Teammate prompts that arrived while no session was running are
      // parked (command-inbox-service ledger state 'parked', cloud rows
      // still claimed) — a chat session starting is their flush signal.
      // Lazy import: the inbox service imports this module for dispatch,
      // same cycle-avoidance as chat-messages/controller.ts's sendToAgent.
      void import('@main/core/commands/command-inbox-service')
        .then(({ commandInboxService }) => commandInboxService.kick())
        .catch((e) => log.warn('session-service: parked-prompt flush kick failed', String(e)));
    }
  } catch (error) {
    supervisor.failSpawn(sessionId, spawnToken);
    throw error;
  }

  return sessionId;
}

/**
 * A plain shell terminal: no agent, so no provider, turn epoch, model config
 * or chat bookkeeping. Exits go through `handleSessionExit` like any terminal
 * (suspended, never respawned) and `stopSession` tears it down.
 */
export function startShellSession(
  sessionId: string,
  workItemId: string,
  opts: { cwd: string; shell: TerminalShell; taskEnvVars: Record<string, string> }
): void {
  const spawnToken = supervisor.beginStart(sessionId, { mode: 'fresh', transport: 'shell' });
  if (!spawnToken) {
    log.info('session-service: concurrent start blocked', { sessionId });
    return;
  }
  try {
    launchShellProcess(sessionId, opts, {
      onExit: (exitCode) =>
        handleSessionExit(sessionId, workItemId, null, 'terminal', exitCode, opts.cwd),
    });
  } catch (error) {
    supervisor.failSpawn(sessionId, spawnToken);
    throw error;
  }
  registerActiveSession({
    sessionId,
    workItemId,
    providerId: null,
    mode: 'shell',
    kind: 'terminal',
  });
  supervisor.acceptSpawn(sessionId, spawnToken);
  db.update(agentSessions)
    .set({
      status: 'active',
      provisionStatus: 'running',
      lastActiveAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function sendInput(sessionId: string, content: string): boolean {
  const session = getActiveSession(sessionId);
  if (!session) return false;

  if (session.chatHandle) {
    session.chatHandle.sendMessage(content);
    return true;
  }

  if (session.mode === 'acp') {
    const connection = getAcpConnection(sessionId);
    if (!connection || !connection.isAlive()) return false;
    connection
      .sendPrompt(content)
      .then((usage) => {
        if (usage) session.bridge?.recordUsage(usage);
        session.bridge?.completeTurn(session.workItemId);
      })
      .catch((e) => {
        log.warn('session-service: failed to send ACP prompt', { sessionId, error: String(e) });
      });
    return true;
  }

  const pty = ptySessionRegistry.get(`session:${sessionId}`);
  if (!pty) return false;
  pty.write(content + '\n');
  return true;
}

export async function stopSession(sessionId: string): Promise<void> {
  // Run even when the session is already gone from the map: a crashed
  // session sits outside activeSessions during the respawn delay, and an
  // explicit stop in that window must still clear the desired flag and
  // cancel the pending respawn — otherwise the session resurrects while the
  // UI shows it stopped.
  supervisor.stop(sessionId);
  cancelPendingRespawn(sessionId);

  const session = getActiveSession(sessionId);
  if (!session) return;

  if (session.kind === 'chat') session.bridge?.flushPartialTurn(session.workItemId);
  await teardownSession(session, { isOrphaned: false });
  if (session.kind === 'chat' && !hasOtherChatSession(session.workItemId, sessionId)) {
    clearSessionEpoch(session.workItemId);
  }
  removeSession(sessionId);
}

/** Persist in-flight turns across every active chat session — called from
    before-quit, where sessions die with the process and would otherwise
    lose everything streamed since the turn began. */
export function flushAllPartialTurns(): void {
  for (const session of listActiveSessions()) {
    if (session.kind !== 'chat' || !session.bridge) continue;
    try {
      session.bridge.flushPartialTurn(session.workItemId);
    } catch (e) {
      log.warn('session-service: failed to flush partial turn on quit', {
        sessionId: session.sessionId,
        error: String(e),
      });
    }
  }
}

// Pending respawn timers by sessionId, so an explicit stop during the
// respawn delay can cancel them (see stopSession). The respawn's own
// startSession would otherwise re-mark the session desired and resurrect it.
const pendingRespawns = new Map<string, ReturnType<typeof setTimeout>>();

function cancelPendingRespawn(sessionId: string): void {
  const timer = pendingRespawns.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  pendingRespawns.delete(sessionId);
}

function scheduleRespawn(
  sessionId: string,
  opts: {
    workItemId: string;
    cwd: string;
    providerId: AgentProviderId;
    kind: 'chat' | 'terminal';
    isResuming: boolean;
    externalSessionId?: string;
  }
): void {
  cancelPendingRespawn(sessionId);
  const timer = setTimeout(() => {
    pendingRespawns.delete(sessionId);
    // Re-checked at fire time: cancelPendingRespawn covers stops that found
    // the timer, this covers any path that cleared the desired flag without
    // knowing about it.
    if (!supervisor.isDesired(sessionId)) return;
    if (!existsSync(opts.cwd)) {
      log.warn('session-service: workspace path gone, skipping respawn', {
        sessionId,
        cwd: opts.cwd,
      });
      supervisor.stop(sessionId);
      return;
    }
    db.update(agentSessions)
      .set({ respawnCount: sql`${agentSessions.respawnCount} + 1` })
      .where(eq(agentSessions.id, sessionId))
      .run();

    // The lane env is re-read: the lane's port block or target may have
    // been set since this session first started.
    resolveSessionLaneEnv(sessionId)
      .then((taskEnvVars) =>
        startSession(sessionId, opts.workItemId, {
          cwd: opts.cwd,
          providerId: opts.providerId,
          kind: opts.kind,
          isResuming: opts.isResuming,
          externalSessionId: opts.externalSessionId,
          taskEnvVars,
        })
      )
      .catch((error) => {
        log.error('session-service: respawn failed', { sessionId, error: String(error) });
      });
  }, RESPAWN_DELAY_MS);
  pendingRespawns.set(sessionId, timer);
}
