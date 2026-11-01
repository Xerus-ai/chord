import { CircleDot, GitBranch } from 'lucide-react';
import type { SidebarWorktreeSummary } from '@shared/sidebar-summaries';
import { getStatusDotColor, isStatusDotPulsing } from '@renderer/lib/status-dot';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { ArchivedLanesSection } from './archived-lanes-section';
import { LaneActionsButton, LaneLabel, LaneRowMenu, type LaneRowHandlers } from './lane-row';
import { labelLaneSessions } from './lane-session-labels';
import type { AgentSessionMode } from './sidebar-options-model';
import { CompareCueText } from './work-item-row-parts';

/** Guide lines, not nesting cards: one hairline down the left of the subtree. */
function TreeBranch({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div
      className="border-l border-border"
      style={{ marginLeft: `${12 + depth * 12}px`, paddingLeft: '8px' }}
    >
      {children}
    </div>
  );
}

function WorktreeRow({
  workItemId,
  worktree,
  showBranch,
  laneHandlers,
}: {
  workItemId: string;
  worktree: SidebarWorktreeSummary;
  showBranch: boolean;
  laneHandlers: LaneRowHandlers;
}) {
  // Not the item on screen, so no lane of it is focused.
  return (
    <LaneRowMenu
      workItemId={workItemId}
      lane={worktree}
      isFocused={false}
      handlers={laneHandlers}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-hover"
    >
      <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
        <GitBranch className="h-3 w-3 text-text-muted" />
        {/* The primary worktree carries a filled ring rather than a "primary"
            pill — one glyph state instead of a second element per row. */}
        {worktree.isPrimary && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-text-muted ring-2 ring-surface" />
        )}
      </span>
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          getStatusDotColor(worktree.bucket),
          isStatusDotPulsing(worktree.bucket) && 'animate-pulse'
        )}
      />
      <span className="flex min-w-0 flex-1 text-list-meta text-text-muted">
        <LaneLabel lane={worktree} showBranch={showBranch} />
      </span>
      {worktree.providerId && (
        <span className="shrink-0 text-list-meta text-text-passive">{worktree.providerId}</span>
      )}
      {worktree.diffStats && (
        <span className="shrink-0 text-list-meta tabular-nums">
          <span className="text-diff-add">+{worktree.diffStats.added}</span>{' '}
          <span className="text-diff-del">-{worktree.diffStats.removed}</span>
        </span>
      )}
      {/* No upstream, or a checkout gone or refused by git: no count, and why.
          The other lanes still count. */}
      {worktree.compareBase.kind !== 'ref' && <CompareCueText cue={worktree.compareBase} />}
      <LaneActionsButton />
    </LaneRowMenu>
  );
}

/**
 * A work item's worktrees, their live sessions, and the subagents inside those
 * sessions — the shape the design calls Depth — then the item's archived
 * lanes, collapsed. Expands in place with guide lines, never a nested card. Suspended sessions are deliberately absent:
 * they live in the Sessions panel, and listing them here would make an idle
 * item look busy.
 */
export function WorkItemSubrows({
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
  if (worktrees.length === 0) return null;

  return (
    <TreeBranch depth={0}>
      {worktrees.map((worktree) => (
        <div key={worktree.id}>
          <WorktreeRow
            workItemId={workItemId}
            worktree={worktree}
            showBranch={showBranch}
            laneHandlers={laneHandlers}
          />
          {agentSessions !== 'off' && worktree.liveSessions.length > 0 && (
            <TreeBranch depth={0}>
              {labelLaneSessions(worktree.liveSessions).map(({ session, label, shownLabel }) => (
                <div key={session.sessionId}>
                  <div
                    onClick={() => onFocusSession(session.sessionId)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-surface-hover"
                  >
                    <CircleDot className="h-2.5 w-2.5 shrink-0 text-text-passive" />
                    <span
                      className="min-w-0 flex-1 truncate text-list-meta text-text-muted"
                      title={label}
                    >
                      {shownLabel}
                    </span>
                    <RelativeTime
                      value={session.lastActiveAt * 1000}
                      compact
                      className="shrink-0 text-list-meta text-text-passive"
                    />
                  </div>
                  {session.subagents.length > 0 && (
                    <TreeBranch depth={0}>
                      {session.subagents.map((subagent) => (
                        <div
                          key={subagent.name}
                          className="flex items-center gap-2 px-2 py-1 text-list-meta text-text-passive"
                        >
                          <CircleDot className="h-2 w-2 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{subagent.name}</span>
                        </div>
                      ))}
                    </TreeBranch>
                  )}
                </div>
              ))}
            </TreeBranch>
          )}
        </div>
      ))}
      <ArchivedLanesSection workItemId={workItemId} handlers={laneHandlers} />
    </TreeBranch>
  );
}
