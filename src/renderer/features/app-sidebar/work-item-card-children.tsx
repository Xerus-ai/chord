import { GitBranch, Terminal } from 'lucide-react';
import type { SidebarLiveSessionSummary, SidebarWorktreeSummary } from '@shared/sidebar-summaries';
import { useFocusedWorktreeId } from '@renderer/features/right-rail/use-focused-worktree';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { ArchivedLanesSection } from './archived-lanes-section';
import { LaneActionsButton, LaneLabel, LaneRowMenu, type LaneRowHandlers } from './lane-row';
import { labelLaneSessions } from './lane-session-labels';
import { getSessionRowProviderId } from './row-presentation';
import type { AgentSessionMode } from './sidebar-options-model';

/**
 * The active card's inside: its worktrees and the sessions live in them,
 * then its archived lanes, collapsed, as under any other row; indented under
 * the row's title rather than hung off a guide line. Inside
 * the card there is no tree to trace — the card border already says what the
 * rows belong to — so the prototype drops the hairline and keeps the indent.
 *
 * Suspended sessions stay absent, as in `WorkItemSubrows`: listing them would
 * make an idle item look busy.
 */
export function WorkItemCardChildren({
  workItemId,
  worktrees,
  agentSessions,
  showBranch,
  laneHandlers,
  onFocusSession,
}: {
  workItemId: string;
  worktrees: readonly SidebarWorktreeSummary[];
  agentSessions: AgentSessionMode;
  showBranch: boolean;
  laneHandlers: LaneRowHandlers;
  onFocusSession: (sessionId: string) => void;
}) {
  // The active card is the item on screen: its row for the lane the centre
  // is focused on is marked, so Open visibly lands somewhere.
  const focusedLaneId = useFocusedWorktreeId(workItemId, workItemId);

  return (
    <div className="flex flex-col gap-px pb-1.5 pl-[33px] pr-1.5">
      {worktrees.map((worktree) => (
        <div key={worktree.id} className="flex flex-col gap-px">
          <LaneRowMenu
            workItemId={workItemId}
            lane={worktree}
            isFocused={worktree.id === focusedLaneId}
            handlers={laneHandlers}
            className="flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-list-meta text-text-muted transition-colors hover:bg-surface-hover"
          >
            <GitBranch className="size-icon-xs shrink-0" strokeWidth={1.75} />
            <LaneLabel lane={worktree} showBranch={showBranch} />
            {worktree.isPrimary && (
              <span className="shrink-0 rounded-xs border border-border bg-surface-hover px-1.5 py-px text-list-badge font-medium text-text-muted">
                primary
              </span>
            )}
            <LaneActionsButton />
          </LaneRowMenu>
          {agentSessions !== 'off' &&
            labelLaneSessions(worktree.liveSessions).map(({ session, label, shownLabel }) => (
              <SessionChildRow
                key={session.sessionId}
                session={session}
                label={label}
                shownLabel={shownLabel}
                onFocus={() => onFocusSession(session.sessionId)}
              />
            ))}
        </div>
      ))}
      <ArchivedLanesSection workItemId={workItemId} handlers={laneHandlers} />
    </div>
  );
}

/** A live chat wears its own provider's logo — two agents in one work item
 *  are the case this view exists for, and one shared logo would hide it. A
 *  terminal wears the terminal glyph, an agent run in it included, as in the
 *  centre tab and the rail (`getSessionRowProviderId`). */
function SessionChildRow({
  session,
  label,
  shownLabel,
  onFocus,
}: {
  session: SidebarLiveSessionSummary;
  /** Its full name, the row's tooltip. */
  label: string;
  /** Its name as the row shows it, from `labelLaneSessions`. */
  shownLabel: string;
  onFocus: () => void;
}) {
  const providerId = getSessionRowProviderId(session);
  const agent = providerId ? agentConfig[providerId] : null;

  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onFocus();
      }}
      className="flex h-6 cursor-pointer items-center gap-1.5 rounded-md py-0 pl-5 pr-1.5 text-list-meta text-text-muted transition-colors hover:bg-surface-hover"
    >
      <span className="flex size-icon-sm shrink-0 items-center justify-center rounded-xs bg-surface-inset">
        {agent ? (
          <AgentLogo
            logo={agent.logo}
            alt={agent.alt}
            isSvg={agent.isSvg}
            invertInDark={agent.invertInDark}
            className="size-2.5"
          />
        ) : (
          <Terminal className="size-2.5 text-text-passive" strokeWidth={1.75} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate" title={label}>
        {shownLabel}
      </span>
      <RelativeTime
        value={session.lastActiveAt * 1000}
        compact
        className="shrink-0 text-text-passive"
      />
    </div>
  );
}
