import type { AgentEvent } from '@shared/events/agentEvents';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import type { RawHookRequest } from './hook-server';

// The hook server's ptyId is always `session:<agentSessionId>` — see
// pty-env.ts's CHORD_PTY_ID and launch-pty-session.ts's `makePtyId`. Sessions
// now bind to a worktree (T0.4), which may not be the work item's primary, so
// the session row — not a fixed `workitem:` id — is the source of truth for
// which work item an incoming hook event belongs to.
const SESSION_PREFIX = 'session:';

function normalizePayload(
  providerId: string,
  body: Record<string, unknown>
): AgentEvent['payload'] {
  const payload: AgentEvent['payload'] = {
    notificationType: (body.notification_type ??
      body.notificationType) as AgentEvent['payload']['notificationType'],
    lastAssistantMessage: (body.last_assistant_message ?? body.lastAssistantMessage) as
      | string
      | undefined,
    title: body.title as string | undefined,
    message: body.message as string | undefined,
  };

  if (!payload.notificationType && providerId === 'codex' && body.type === 'agent-turn-complete') {
    payload.notificationType = 'idle_prompt';
  }

  return payload;
}

export async function enrichEvent(raw: RawHookRequest): Promise<AgentEvent> {
  const body = raw.body ? JSON.parse(raw.body) : {};

  if (!raw.ptyId.startsWith(SESSION_PREFIX)) {
    throw new Error(`Unrecognised ptyId format (expected session: prefix): ${raw.ptyId}`);
  }

  const sessionId = raw.ptyId.slice(SESSION_PREFIX.length);
  // Throws if the session or its worktree's work item no longer exists —
  // fail fast rather than silently dropping the event.
  const worktree = resolveSessionWorktreeRow(sessionId);

  const payload = normalizePayload('unknown', body);

  return {
    type: raw.type as AgentEvent['type'],
    ptyId: raw.ptyId,
    workItemId: worktree.workItemId,
    sessionId,
    worktreeId: worktree.id,
    timestamp: Date.now(),
    payload,
  };
}
