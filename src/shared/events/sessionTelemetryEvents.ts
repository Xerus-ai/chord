import { defineEvent } from '@shared/ipc/events';
import type { AgentProviderId } from '../agent-provider-registry';
import type { ContextUsage } from '../session-telemetry';
import type { UsageWindow } from '../usage-window';

/** A live session's context fill and running cost. Topic: the session id. */
export interface SessionTelemetryUpdate {
  sessionId: string;
  context: ContextUsage | null;
  costUsd: number | null;
}

export const sessionTelemetryChannel = defineEvent<SessionTelemetryUpdate>('session:telemetry');

/** A provider's plan usage windows, whichever session reported them. Topic: the provider id. */
export interface ProviderUsageUpdate {
  providerId: AgentProviderId;
  windows: UsageWindow[];
  /** Epoch ms of the report the windows came from. */
  reportedAt: number;
}

export const providerUsageChannel = defineEvent<ProviderUsageUpdate>('provider:usage');
