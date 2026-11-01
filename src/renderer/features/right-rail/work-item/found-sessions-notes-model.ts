import {
  listAgentsUnableToImport,
  type SessionSourceFailure,
  type SessionSourceUnsupported,
  type WorkItemImportableSessions,
} from '@shared/session-import';

export interface FoundSessionsNotes {
  /** Sources that failed to list: errors, always said. */
  failures: SessionSourceFailure[];
  /** Installed agents that answer but can't list or load a session. */
  unsupported: SessionSourceUnsupported[];
  /** Installed terminal-only agents, by name. */
  terminalOnly: string[];
}

/**
 * What the rail says the import list leaves out. Which agents can't import is
 * only worth saying beside sessions it does offer; said under every work item,
 * a brand-new one included, it was noise (devstation-6re). A source that
 * failed to list is an error and is always said.
 */
export function selectFoundSessionsNotes(
  found: WorkItemImportableSessions,
  installedAgentIds: ReadonlySet<string>
): FoundSessionsNotes {
  const offersSessions = found.lanes.some((lane) => lane.sessions.length > 0);
  if (!offersSessions) return { failures: found.failures, unsupported: [], terminalOnly: [] };
  return {
    failures: found.failures,
    unsupported: found.unsupported,
    terminalOnly: listAgentsUnableToImport()
      .filter((agent) => installedAgentIds.has(agent.providerId))
      .map((agent) => agent.name),
  };
}
