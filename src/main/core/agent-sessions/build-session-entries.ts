/**
 * Maps local `agent_sessions` rows onto the cloud session registry's wire
 * shape (devstation-uka).
 *
 * Kept in its own module, free of any db import, for the reason thread-digest
 * records: anything reaching the main-process db client drags in
 * better-sqlite3, which is built for Electron's ABI and cannot load under
 * vitest — so the mapping rules would be untestable if they lived beside the
 * query in session-cloud-sync.ts.
 */
import { CLOUD_SESSION_STATUSES, type CloudSessionPutEntry } from '@chord/protocol';

/** The subset of an `agent_sessions` row this mapping reads. */
export interface PublishableSessionRow {
  id: string;
  kind: string;
  agentProviderId: string | null;
  title: string | null;
  status: string;
  worktreeId: string | null;
  /** Unix epoch SECONDS, as sqlite stores it. */
  lastActiveAt: number;
  /** As the owner's composer names them (session-agent-labels.ts); null when unnamed. */
  modelLabel: string | null;
  permissionModeLabel: string | null;
}

const PUBLISHED_STATUSES: ReadonlySet<string> = new Set(CLOUD_SESSION_STATUSES);

/**
 * Chat sessions only. A shell terminal is not a shared conversation, and its
 * title and cwd are the owner machine's business — the filter lives here,
 * where it is visible and tested, rather than buried in the query.
 */
export function buildSessionEntries(rows: PublishableSessionRow[]): CloudSessionPutEntry[] {
  return rows
    .filter((row) => row.kind === 'chat')
    .map((row) => {
      // `status` is free text locally. A value the wire schema does not know
      // would come back from the route as a 400 naming only a zod path, so
      // fail here instead, where the offending session can be named.
      if (!PUBLISHED_STATUSES.has(row.status)) {
        throw new Error(
          `session ${row.id} has status '${row.status}', which is not publishable ` +
            `(expected one of ${CLOUD_SESSION_STATUSES.join(', ')})`
        );
      }

      return {
        id: row.id,
        agent_provider_id: row.agentProviderId,
        title: row.title,
        status: row.status as CloudSessionPutEntry['status'],
        worktree_id: row.worktreeId,
        last_active_at: new Date(row.lastActiveAt * 1000).toISOString(),
        model_label: row.modelLabel,
        permission_mode_label: row.permissionModeLabel,
      };
    });
}
