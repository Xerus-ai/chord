import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { forkClaudeConversation } from './fork-claude-conversation';
import { forkCodexThread } from './fork-codex-thread';

/** A chat's conversation, at the turn it is cut. */
export interface HistoryPoint {
  providerId: AgentProviderId;
  transport: 'claude-sdk' | 'codex-app-server';
  externalSessionId: string;
  historyRef: string;
  /** Where the fork is written and resumed. */
  cwd: string;
}

export interface ForkedConversation {
  externalId: string;
  /** What an earlier turn's history ref is in the fork; null when the fork does not have it. */
  mapRef: (sourceRef: string) => string | null;
}

/**
 * Forks the conversation at the history point: Claude `forkSession`, Codex
 * `thread/fork`. `into` is another checkout the fork continues in (Fork to
 * new worktree); otherwise it continues in the point's cwd.
 */
export async function forkConversationAtTurn(
  point: HistoryPoint,
  opts: { into?: string } = {}
): Promise<ForkedConversation> {
  if (point.transport === 'claude-sdk') {
    const { sessionId, forkedRefs } = await forkClaudeConversation({
      externalSessionId: point.externalSessionId,
      cwd: point.cwd,
      historyRef: point.historyRef,
      into: opts.into,
    });
    return { externalId: sessionId, mapRef: (ref) => forkedRefs.get(ref) ?? null };
  }
  const command = await resolveAgentExecutable({
    providerId: point.providerId,
    cli: getProvider(point.providerId)?.cli,
  });
  const { threadId, turnIds } = await forkCodexThread({
    command,
    threadId: point.externalSessionId,
    historyRef: point.historyRef,
    cwd: opts.into ?? point.cwd,
  });
  const kept = new Set(turnIds);
  return { externalId: threadId, mapRef: (ref) => (kept.has(ref) ? ref : null) };
}
