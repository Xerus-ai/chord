import { isValidProviderId } from './agent-provider-registry';
import { getProvider } from './agent-providers';

/**
 * The one name a session goes by on every surface — its centre tab, the right
 * rail's worktree row, the sidebar row. Its title when it has one (a shell's
 * label, a named chat); otherwise the agent it runs, in a chat or as a CLI in
 * a terminal; only a session with neither is "Terminal" or "Chat".
 */
export function labelAgentSession(session: {
  kind: string;
  title: string | null;
  agentProviderId: string | null;
}): string {
  if (session.title) return session.title;
  if (isValidProviderId(session.agentProviderId)) {
    const provider = getProvider(session.agentProviderId);
    if (provider) return provider.name;
  }
  return session.kind === 'terminal' ? 'Terminal' : 'Chat';
}
