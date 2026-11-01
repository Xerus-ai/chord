import { forgetSessionCatalog } from '@main/core/agent-catalog/session-catalogs';
import { clearHookPrompt } from '@main/core/agent-hooks/pending-hook-prompts';
import { clearChatSessionConfig } from './session-config-store';
import { forgetSessionTelemetry } from './session-telemetry';

/**
 * Drops per-session state that must not outlive a session ended for good.
 * Call wherever a session row is set to `done` or deleted.
 */
export function forgetEndedSession(sessionId: string): void {
  clearChatSessionConfig(sessionId);
  clearHookPrompt(sessionId);
  forgetSessionTelemetry(sessionId);
  forgetSessionCatalog(sessionId);
}
