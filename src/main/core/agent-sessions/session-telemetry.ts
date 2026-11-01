import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import {
  sessionTelemetryChannel,
  type SessionTelemetryUpdate,
} from '@shared/events/sessionTelemetryEvents';
import {
  EMPTY_SESSION_TELEMETRY,
  reduceSessionTelemetry,
  type SessionTelemetry,
} from '@shared/session-telemetry';
import { events } from '@main/lib/events';

/**
 * The latest context fill and cost per live session, pushed to the composer
 * as they change. In memory only: a resumed session reports afresh on start
 * (the Claude transport reads context usage right after init).
 */
const bySession = new Map<string, SessionTelemetry>();

function toUpdate(sessionId: string, t: SessionTelemetry): SessionTelemetryUpdate {
  return { sessionId, context: t.context, costUsd: t.costUsd };
}

export function recordSessionTelemetry(sessionId: string, event: AgentOutputEvent): void {
  if (event.type !== 'context_usage' && event.type !== 'usage') return;
  const prev = bySession.get(sessionId) ?? EMPTY_SESSION_TELEMETRY;
  const next = reduceSessionTelemetry(prev, event);
  if (next === prev) return;
  bySession.set(sessionId, next);
  events.emit(sessionTelemetryChannel, toUpdate(sessionId, next), sessionId);
}

/** For a composer mounted after the session already reported. */
export function getSessionTelemetry(sessionId: string): SessionTelemetryUpdate {
  return toUpdate(sessionId, bySession.get(sessionId) ?? EMPTY_SESSION_TELEMETRY);
}

export function forgetSessionTelemetry(sessionId: string): void {
  bySession.delete(sessionId);
}
