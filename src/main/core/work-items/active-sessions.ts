import type { AgentProviderId } from '@shared/agent-provider-registry';
import { announceSessionsChanged } from '@main/core/agent-sessions/announce-sessions-changed';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import type { LaunchConfig } from '@main/core/agent-sessions/session-config-store';
import type { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';

/** `shell` is a plain shell terminal (`launchShellProcess`), not an agent. */
export type TransportMode = 'acp' | 'pty' | 'claude-sdk' | 'codex-app-server' | 'shell';

export interface ActiveSession {
  sessionId: string;
  workItemId: string;
  /** Null only for a `shell` session. */
  providerId: AgentProviderId | null;
  mode: TransportMode;
  kind: 'chat' | 'terminal';
  bridge?: AgentEventBridge;
  /** Set for the structured in-process transports (claude-sdk, codex-app-server). */
  chatHandle?: ChatSessionHandle;
  abortController?: AbortController;
  launch?: LaunchConfig;
}

/**
 * The sessions running in this app: every live agent and terminal, by id and
 * by work item. `session-service` is the only writer — it registers a session
 * once its process is up and unregisters it on every end path.
 */
const activeSessions = new Map<string, ActiveSession>();
const workItemSessions = new Map<string, Set<string>>();

export function registerActiveSession(session: ActiveSession): void {
  // Every session-start path funnels through here, which makes it the one
  // place the cloud registry has to be told a thread appeared.
  scheduleSessionCloudSync(session.workItemId);
  activeSessions.set(session.sessionId, session);
  let set = workItemSessions.get(session.workItemId);
  if (!set) {
    set = new Set();
    workItemSessions.set(session.workItemId, set);
  }
  set.add(session.sessionId);
  // ...and the renderer, whose sidebar would otherwise wait for its next poll.
  // The row writes that follow a start run in this same tick, before any
  // re-read the event prompts.
  announceSessionsChanged(session.workItemId);
}

/** Forgets a session; returns it, or undefined when it was not running. */
export function unregisterActiveSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  if (!session) return undefined;
  activeSessions.delete(sessionId);
  const set = workItemSessions.get(session.workItemId);
  if (set) {
    set.delete(sessionId);
    if (set.size === 0) workItemSessions.delete(session.workItemId);
  }
  // Every end path: the row is suspended in this same tick (`session-service`).
  announceSessionsChanged(session.workItemId);
  return session;
}

export function getActiveSessions(workItemId: string): ActiveSession[] {
  const sessionIds = workItemSessions.get(workItemId);
  if (!sessionIds) return [];
  const result: ActiveSession[] = [];
  for (const id of sessionIds) {
    const session = activeSessions.get(id);
    if (session) result.push(session);
  }
  return result;
}

export function getActiveSession(sessionId: string): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

/** The running process now uses `launch` (a selection applied in-process). */
export function setActiveSessionLaunch(sessionId: string, launch: LaunchConfig): void {
  const session = activeSessions.get(sessionId);
  if (session) session.launch = launch;
}

/** Every live session across all work items — the snapshot the sidebar seeds
    its running state from, so agents already running when it mounts are
    visible without waiting for their next event. */
export function listActiveSessions(): ActiveSession[] {
  return [...activeSessions.values()];
}

export function hasOtherChatSession(workItemId: string, sessionId: string): boolean {
  return getActiveSessions(workItemId).some((s) => s.kind === 'chat' && s.sessionId !== sessionId);
}
