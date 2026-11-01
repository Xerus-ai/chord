import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import {
  describeSessionImportError,
  type ImportableSession,
  type WorkItemImportableSessions,
} from '@shared/session-import';
import { useInstalledAgents } from '@renderer/features/composer-controls/use-installed-agents';
import { ProviderTile } from '@renderer/lib/components/provider-tile';
import { rpc } from '@renderer/lib/ipc';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { RailError } from '../rail-primitives';
import { selectFoundSessionsNotes } from './found-sessions-notes-model';

/**
 * Listing starts Codex's app-server and every installed ACP agent, so it is
 * not on the five-second session poll; a session started outside Chord shows
 * within this long while the rail is open.
 */
const FOUND_SESSIONS_REFRESH_MS = 30_000;

const foundSessionsKey = (workItemId: string) => ['sessionImport', 'found', workItemId];

/** Agent sessions in this work item's lane folders that Chord does not own (plan §Phase 3 slice 5). */
export function useFoundSessions(workItemId: string) {
  return useQuery({
    queryKey: foundSessionsKey(workItemId),
    queryFn: async () => (await rpc.sessionImport.listForWorkItem(workItemId)).data,
    refetchInterval: FOUND_SESSIONS_REFRESH_MS,
  });
}

const providerName = (providerId: AgentProviderId) => getProvider(providerId)?.name ?? providerId;

/** One lane's found sessions, under the lane's own sessions, each with Import. */
export function FoundSessions({
  workItemId,
  worktreeId,
  sessions,
  onImported,
}: {
  workItemId: string;
  worktreeId: string;
  sessions: ImportableSession[];
  /** The imported chat's session id: the caller opens it. */
  onImported: (sessionId: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="ml-3.5 mb-1.5 flex flex-col gap-px border-l border-border pl-2">
      <span className="px-1.5 pt-1 text-list-meta font-semibold uppercase tracking-list-label text-text-passive">
        Found on this machine
      </span>
      {sessions.map((session) => (
        <FoundSessionRow
          key={`${session.providerId}:${session.providerSessionId}`}
          workItemId={workItemId}
          worktreeId={worktreeId}
          session={session}
          onImported={onImported}
        />
      ))}
    </div>
  );
}

function FoundSessionRow({
  workItemId,
  worktreeId,
  session,
  onImported,
}: {
  workItemId: string;
  worktreeId: string;
  session: ImportableSession;
  onImported: (sessionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const importing = useMutation({
    mutationFn: async () =>
      rpc.sessionImport.importSession({
        workItemId,
        worktreeId,
        providerId: session.providerId,
        providerSessionId: session.providerSessionId,
      }),
    onSuccess: async (result) => {
      if (!result.success) return;
      // Chord holds it now: it leaves the list at once, without waiting for a
      // re-list that starts every agent again.
      queryClient.setQueryData<WorkItemImportableSessions>(
        foundSessionsKey(workItemId),
        (found) =>
          found && {
            ...found,
            lanes: found.lanes.map((lane) => ({
              ...lane,
              sessions: lane.sessions.filter(
                (s) => s.providerSessionId !== session.providerSessionId
              ),
            })),
          }
      );
      await queryClient.invalidateQueries({ queryKey: ['agentSessions', workItemId] });
      onImported(result.data.sessionId);
    },
  });
  const failure =
    importing.data && !importing.data.success
      ? describeSessionImportError(importing.data.error)
      : importing.error instanceof Error
        ? importing.error.message
        : null;
  const title = session.title ?? `${providerName(session.providerId)} session`;

  return (
    <div
      data-testid="found-session"
      data-provider-session-id={session.providerSessionId}
      className="flex flex-col gap-px rounded-md px-1.5 py-1"
    >
      <span className="flex w-full items-center gap-1.5">
        <span className="flex size-[15px] shrink-0 items-center justify-center">
          <ProviderTile providerId={session.providerId} />
        </span>
        <span title={title} className="min-w-0 flex-1 truncate text-list-meta text-text-muted">
          {title}
        </span>
        <button
          type="button"
          disabled={importing.isPending}
          onClick={() => importing.mutate()}
          className="shrink-0 cursor-pointer rounded-xs border border-border-strong bg-surface-inset px-1.5 py-px text-list-badge font-medium text-text-muted transition-colors hover:text-text disabled:cursor-default disabled:opacity-60"
        >
          {importing.isPending ? 'Importing…' : 'Import'}
        </button>
      </span>
      <span className="flex w-full items-center gap-1 truncate pl-[21px] text-list-meta text-text-passive">
        {providerName(session.providerId)}
        {session.lastActivityAt !== null && (
          <>
            {' · '}
            <RelativeTime value={session.lastActivityAt} compact />
          </>
        )}
      </span>
      {failure && <RailError message={failure} />}
    </div>
  );
}

/**
 * What the lists above leave out, said once for the work item: sources that
 * failed to list (with why), and — beside sessions the lists offer — installed
 * agents that answer but can't list or load a session, and the terminal-only
 * agents installed here (`selectFoundSessionsNotes`).
 */
export function FoundSessionsNotes({ found }: { found: WorkItemImportableSessions | undefined }) {
  const installed = useInstalledAgents();
  if (!found) return null;
  const { failures, unsupported, terminalOnly } = selectFoundSessionsNotes(
    found,
    new Set(installed.map((agent) => agent.id))
  );
  if (failures.length === 0 && unsupported.length === 0 && terminalOnly.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 px-3 pb-2 pt-1">
      {failures.map((failure) => (
        <RailError
          key={failure.providerId}
          message={`Couldn't list ${providerName(failure.providerId)} sessions: ${failure.message}`}
        />
      ))}
      {unsupported.map((agent) => (
        <p key={agent.providerId} className="text-list-meta text-text-passive">
          {providerName(agent.providerId)} can't{' '}
          {agent.reason === 'no_session_list' ? 'list' : 'load'} its sessions, so they aren't
          offered.
        </p>
      ))}
      {terminalOnly.length > 0 && (
        <p className="text-list-meta text-text-passive">
          Sessions from {terminalOnly.join(', ')} can't be imported: Chord runs them in a terminal
          only.
        </p>
      )}
    </div>
  );
}
