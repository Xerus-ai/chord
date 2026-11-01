import { type AgentProviderId } from './agent-provider-registry';
import { AGENT_PROVIDERS, getProvider } from './agent-providers';

/**
 * Where a provider's outside sessions are read from (plan §Phase 3 slice 5):
 * Claude's transcripts, Codex's app-server, or an ACP agent's `session/list`
 * and `session/load`. The same split as a chat session's transport.
 */
export type SessionImportSource = 'claude' | 'codex' | 'acp';

export function sessionImportSource(providerId: AgentProviderId): SessionImportSource | null {
  if (providerId === 'claude') return 'claude';
  const provider = getProvider(providerId);
  if (provider?.communication === 'app-server') return 'codex';
  if (provider?.communication === 'acp' && provider.acpConfig) return 'acp';
  return null;
}

/** Agents that run in a terminal only: nothing to list or load a session with. */
export function listAgentsUnableToImport(): { providerId: AgentProviderId; name: string }[] {
  return AGENT_PROVIDERS.filter((provider) => sessionImportSource(provider.id) === null).map(
    (provider) => ({ providerId: provider.id, name: provider.name })
  );
}

/** An agent session found in a lane's folder that Chord does not own. */
export interface ImportableSession {
  providerId: AgentProviderId;
  providerSessionId: string;
  /** Null when the agent reports none. */
  title: string | null;
  /** ms epoch; null when the agent reports none. */
  lastActivityAt: number | null;
  cwd: string;
}

/** A source that could not be read for this work item, named with why. */
export interface SessionSourceFailure {
  providerId: AgentProviderId;
  message: string;
}

/** An installed agent that answers but can't list or load sessions. */
export interface SessionSourceUnsupported {
  providerId: AgentProviderId;
  reason: 'no_session_list' | 'no_session_load';
}

export interface LaneImportableSessions {
  worktreeId: string;
  sessions: ImportableSession[];
}

export interface WorkItemImportableSessions {
  lanes: LaneImportableSessions[];
  failures: SessionSourceFailure[];
  unsupported: SessionSourceUnsupported[];
}

export type SessionImportError =
  | { type: 'lane_not_found' }
  | { type: 'lane_not_checked_out' }
  | { type: 'already_imported'; sessionId: string; workItemId: string }
  | { type: 'session_not_found' }
  | { type: 'provider_unsupported'; providerId: string }
  | { type: 'read_failed'; message: string }
  | { type: 'write_failed'; message: string };

/** What the import error says to the user, inline under the row. */
export function describeSessionImportError(error: SessionImportError): string {
  switch (error.type) {
    case 'lane_not_found':
      return 'This branch is no longer part of the work item.';
    case 'lane_not_checked_out':
      return "This branch isn't checked out on this machine yet.";
    case 'already_imported':
      return 'Already imported into Chord.';
    case 'session_not_found':
      return 'The agent no longer has this session.';
    case 'provider_unsupported':
      return `${error.providerId} can't import sessions.`;
    case 'read_failed':
      return `Couldn't read the session: ${error.message}`;
    case 'write_failed':
      return `Couldn't save the session: ${error.message}`;
  }
}
