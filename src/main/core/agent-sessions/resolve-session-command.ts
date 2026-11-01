import type { AgentProviderId } from '@shared/agent-provider-registry';

const PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME = new Set<string>([
  'amp',
  'codex',
  'commandcode',
  'droid',
  'goose',
]);

export function resolveSessionCommandArgs(opts: {
  providerId: AgentProviderId;
  sessionId: string;
  externalSessionId?: string;
  isResuming: boolean;
}): { sessionId: string; isResuming: boolean } {
  if (PROVIDER_SESSION_ID_REQUIRED_FOR_RESUME.has(opts.providerId) && opts.isResuming) {
    const nativeId = opts.externalSessionId;
    if (nativeId && nativeId !== opts.sessionId) {
      return { sessionId: nativeId, isResuming: true };
    }
    return { sessionId: opts.sessionId, isResuming: false };
  }

  return { sessionId: opts.externalSessionId ?? opts.sessionId, isResuming: opts.isResuming };
}
