import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';

const QUIET_PERIOD_MS = 800;
const MAX_WAIT_MS = 15_000;

export function scheduleKeystrokeInjection(args: {
  pty: Pty;
  sessionId: string;
  providerId: AgentProviderId;
  initialPrompt: string | undefined;
  isResuming: boolean;
}): void {
  if (args.isResuming) return;
  if (!args.initialPrompt?.trim()) return;

  const providerDef = getProvider(args.providerId);
  if (!providerDef?.useKeystrokeInjection) return;

  const payload = buildPromptInjectionPayload({
    providerId: args.providerId,
    text: args.initialPrompt,
  });

  let injected = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const inject = () => {
    if (injected) return;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    try {
      args.pty.write(`${payload}\r`);
    } catch (error) {
      log.warn('keystroke-injection: failed to inject initial prompt', {
        providerId: args.providerId,
        sessionId: args.sessionId,
        error: String(error),
      });
    }
  };

  const maxWaitTimer = setTimeout(inject, MAX_WAIT_MS);

  args.pty.onData(() => {
    if (injected) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(inject, QUIET_PERIOD_MS);
  });

  args.pty.onExit(() => {
    const wasInjected = injected;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    if (!wasInjected) {
      log.warn('keystroke-injection: PTY exited before prompt could be injected', {
        providerId: args.providerId,
        sessionId: args.sessionId,
      });
    }
  });
}
