import { useQuery } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { checkoutStateOf } from '@shared/work-item-checkout-state';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { requestArtifactCard } from '@renderer/features/artifacts/artifact-card-request';
import { useArtifactRailSummary } from '@renderer/features/artifacts/use-artifact-rail-summary';
import { useWorkItemArtifacts } from '@renderer/features/artifacts/use-work-item-artifacts';
import { useLocalSharingAvailability } from '@renderer/features/sharing/use-local-sharing-availability';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { useLanePullRequests } from '@renderer/features/work-list/use-lane-pull-requests';
import { ListRow } from '@renderer/lib/components/list-row';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { pickLaneSession } from '../focus-lane';
import { useRailScope } from '../rail-context';
import { HeaderAction, PanelShell, RailEmpty, RailError, RailSection } from '../rail-primitives';
import { useRailStore } from '../rail-store';
import { useLiveWorktrees } from '../use-focused-worktree';
import { ArtifactRailRow } from './artifact-rail-row';
import { FoundSessions, FoundSessionsNotes, useFoundSessions } from './found-sessions';
import { toLanePrRow } from './lane-pr-row';
import { ParticipantsSection } from './participants-section';
import { parseSessionQuery, SESSION_FILTER_MIN_ROWS, sessionMatchesQuery } from './session-filter';
import { describeTicketRow } from './ticket-row';
import { useWorktreeStats } from './use-worktree-stats';
import { WorktreeGroup, type WorktreePullRequest } from './worktree-group';

/**
 * The map of the work item: why it exists, what it points at, what it produced,
 * where it runs, and who is on it.
 *
 * Order is by use, not by narrative: brief, worktrees, tickets, artifacts,
 * people. Worktrees is the only section a user NAVIGATES from — its session
 * rows are what resuming work means — while everything below it is reference
 * read once. Telling the story in order (why → plan → work → who) put the
 * most-clicked rows under a variable-height Artifacts list, so on a long-lived
 * work item resuming a session meant scrolling. Brief stays on top because it
 * is three clamped lines and costs nothing above the fold.
 *
 * Every section header carries the action that adds to it. Sessions are not a
 * section: they belong to a worktree, and they are nested under the one they
 * run in. Listing them a second time on their own was the duplication this tab
 * replaced. A focused artifact has no section here: its status is on its tab's
 * file bar, and Approve / Ask agent to build are the band's.
 */
export function WorkItemPanel({ workItem }: { workItem: WorkItemRow }) {
  const scope = useRailScope();
  const { workItemId, layoutKey, worktreeId } = scope;
  const worktrees = useLiveWorktrees(workItemId);
  const showLinkIssue = useShowModal('linkIssueModal');
  const showShare = useShowModal('shareModal');
  const sharing = useLocalSharingAvailability(workItem);
  const pickPanel = useRailStore((state) => state.pickPanel);
  const lanePrs = useLanePullRequests(workItemId);
  const [sessionQuery, setSessionQuery] = useState('');

  const artifactsQuery = useWorkItemArtifacts(workItemId);
  const railSummary = useArtifactRailSummary(workItemId);

  const sessionsQuery = useQuery({
    queryKey: ['agentSessions', workItemId],
    queryFn: async () => (await rpc.agentSessions.getAll(workItemId)).data.sessions,
    refetchInterval: 5000,
  });

  // One call for every session row's count and preview — the per-row
  // alternative is an N+1 against chat_messages on a five-second poll.
  const sessionSummariesQuery = useQuery({
    queryKey: ['agentSessions', 'rowSummaries', workItemId],
    queryFn: async () => (await rpc.agentSessions.getRowSummaries(workItemId)).data.summaries,
    refetchInterval: 5000,
  });

  const ticketsQuery = useQuery({
    queryKey: ['workItemTickets', workItemId],
    queryFn: async () => (await rpc.workItemTickets.getTickets(workItemId)).data.tickets,
    refetchInterval: 30000,
  });

  const briefQuery = useQuery({
    queryKey: ['chatMessages', 'brief', workItemId],
    queryFn: async () => (await rpc.chatMessages.getFirstHumanMessage(workItemId)).data.content,
    staleTime: 60_000,
  });

  const stats = useWorktreeStats(workItemId, worktrees);
  const foundQuery = useFoundSessions(workItemId);

  const artifacts = artifactsQuery.data ?? [];
  // Memoized, not `?? []` inline: a fresh empty array every render would
  // rebuild `visibleGroups` on every poll of every other query.
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const sessionSummaries = useMemo(
    () => new Map((sessionSummariesQuery.data ?? []).map((row) => [row.sessionId, row])),
    [sessionSummariesQuery.data]
  );
  const tickets = ticketsQuery.data ?? [];

  const openSession = useCallback(
    (sessionId: string) =>
      window.dispatchEvent(
        new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId } })
      ),
    []
  );

  // The box earns its place only once the list stops being scannable; below
  // the threshold it would be chrome above the rows the user came to click.
  const showSessionFilter = sessions.length > SESSION_FILTER_MIN_ROWS;
  const parsedQuery = useMemo(() => parseSessionQuery(sessionQuery), [sessionQuery]);
  const filtering = showSessionFilter && sessionQuery.trim().length > 0;

  const visibleGroups = useMemo(
    () =>
      worktrees
        .map((worktree) => ({
          worktree,
          // A null `worktreeId` means the primary, the same convention the
          // main process uses when it resolves a session's worktree.
          sessions: sessions.filter(
            (session) =>
              (session.worktreeId === null
                ? worktree.isPrimary
                : session.worktreeId === worktree.id) &&
              (!filtering ||
                sessionMatchesQuery(
                  {
                    title: session.title,
                    preview: sessionSummaries.get(session.id)?.preview ?? null,
                    branch: worktree.branchName ?? null,
                    model: session.model,
                  },
                  parsedQuery
                ))
          ),
        }))
        // While filtering, a group with nothing left collapses away — keeping
        // an empty checkout on screen buries the matches it was meant to find.
        .filter((group) => !filtering || group.sessions.length > 0),
    [worktrees, sessions, sessionSummaries, parsedQuery, filtering]
  );

  // Each lane's own PR (plan 2026-09-26 P8), on that lane's row.
  const pullRequestFor = (laneId: string): WorktreePullRequest | null =>
    toLanePrRow(lanePrs.data?.lanes.find((lane) => lane.worktreeId === laneId)?.pr ?? null);

  return (
    <PanelShell title="Work item">
      {briefQuery.data && (
        <section className="flex flex-col gap-1 px-3 pb-1 pt-3">
          <span className="text-list-meta font-semibold uppercase tracking-list-label text-text-passive">
            Brief
          </span>
          <p className="line-clamp-3 text-list-row text-text-muted">{briefQuery.data}</p>
        </section>
      )}

      <RailSection sectionId="work-item:worktrees" title="Worktrees" count={worktrees.length}>
        {showSessionFilter && (
          <div className="px-1.5 pb-1">
            <input
              type="search"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="Filter sessions — branch:name"
              aria-label="Filter sessions"
              className="h-6 w-full rounded-md border border-border-strong bg-surface-inset px-2 text-list-meta text-text placeholder:text-text-passive focus:border-focus-ring focus:outline-none"
            />
          </div>
        )}
        {worktrees.length === 0 ? (
          <RailEmpty>No worktrees</RailEmpty>
        ) : visibleGroups.length === 0 ? (
          <RailEmpty>No sessions match</RailEmpty>
        ) : (
          visibleGroups.map(({ worktree, sessions: groupSessions }) => (
            <WorktreeGroup
              key={worktree.id}
              worktree={worktree}
              checkout={worktree.isPrimary ? checkoutStateOf(workItem.provisionStatus) : null}
              stat={stats.get(worktree.id) ?? null}
              sessions={groupSessions}
              summaries={sessionSummaries}
              pullRequest={pullRequestFor(worktree.id)}
              focused={worktree.id === worktreeId}
              onFocus={() => {
                const first = pickLaneSession(worktree.id, worktrees, sessions);
                if (first) openSession(first);
              }}
              onOpenPullRequest={() => {
                // Checks shows the focused lane's PR, so this lane is focused first.
                const first = pickLaneSession(worktree.id, worktrees, sessions);
                if (first) openSession(first);
                pickPanel('checks-pr');
              }}
              onOpenSession={openSession}
            >
              <FoundSessions
                workItemId={workItemId}
                worktreeId={worktree.id}
                sessions={
                  foundQuery.data?.lanes.find((lane) => lane.worktreeId === worktree.id)
                    ?.sessions ?? []
                }
                onImported={openSession}
              />
            </WorktreeGroup>
          ))
        )}
        {foundQuery.error instanceof Error && (
          <RailError message={`Couldn't look for sessions: ${foundQuery.error.message}`} />
        )}
        <FoundSessionsNotes found={foundQuery.data} />
      </RailSection>

      <RailSection
        sectionId="work-item:tickets"
        title="Tickets"
        count={tickets.length}
        trailing={<HeaderAction label="+ Link" onClick={() => showLinkIssue({ workItemId })} />}
      >
        {ticketsQuery.error instanceof Error && <RailError message={ticketsQuery.error.message} />}
        {tickets.length === 0 ? (
          <RailEmpty>No tickets linked</RailEmpty>
        ) : (
          tickets.map((ticket) => (
            <ListRow
              key={ticket.ticketId}
              leading={<Target className="size-icon-sm text-text-passive" />}
              {...describeTicketRow(ticket)}
              metaInline
              tooltip={ticket.ticketUrl ?? undefined}
              onOpen={
                ticket.ticketUrl
                  ? () => void rpc.app.openExternal(ticket.ticketUrl as string)
                  : undefined
              }
            />
          ))
        )}
      </RailSection>

      <RailSection
        sectionId="work-item:artifacts"
        title="Artifacts"
        count={artifacts.length}
        trailing={
          <HeaderAction
            label="+ Add"
            onClick={() => pickPanel('explorer')}
            title="Add a file from the Files tab"
          />
        }
      >
        {artifactsQuery.error instanceof Error && (
          <RailError message={artifactsQuery.error.message} />
        )}
        {railSummary.error instanceof Error && (
          <RailError message={`Comment and version counts: ${railSummary.error.message}`} />
        )}
        {artifacts.length === 0 ? (
          <RailEmpty>No artifacts yet</RailEmpty>
        ) : (
          artifacts.map((artifact) => (
            <ArtifactRailRow
              key={artifact.id}
              artifactId={artifact.id}
              name={artifact.name}
              filePath={artifact.filePath}
              counts={railSummary.counts.get(artifact.id)}
              onOpen={() =>
                openCenterTab(layoutKey, artifactPathTab(artifact.id, artifact.name), {
                  preview: true,
                })
              }
              onOpenCard={(card) => {
                requestArtifactCard(artifact.id, card);
                openCenterTab(layoutKey, artifactPathTab(artifact.id, artifact.name), {
                  preview: true,
                });
              }}
            />
          ))
        )}
      </RailSection>

      <ParticipantsSection
        workItemId={workItemId}
        availability={sharing}
        onShare={() => showShare({ workItemId, workItemName: workItem.name })}
      />
    </PanelShell>
  );
}
