import { GitPullRequest, Play, Terminal } from 'lucide-react';
import { labelAgentSession } from '@shared/agent-session-label';
import { describeCheckoutState, type CheckoutState } from '@shared/work-item-checkout-state';
import type { Worktree } from '@shared/worktrees';
import type { SessionRowSummary } from '@main/core/agent-sessions/session-row-summaries';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { DiffText } from '@renderer/lib/components/diff-counts';
import { MiddleTruncate } from '@renderer/lib/components/middle-truncate';
import { ProviderTile } from '@renderer/lib/components/provider-tile';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { ENDED_SESSION_WORD, orderSessionRows, sessionRowStatus } from './session-row-presentation';

export interface WorktreeStat {
  added: number;
  removed: number;
  files: number;
}

export interface WorktreePullRequest {
  number: number;
  title: string;
  state: string;
  signal: StatusSignal;
}

/**
 * One checkout, with everything that happens inside it nested under it.
 *
 * This is the shape the map is for: a work item is worktrees, and a worktree
 * is its pull request and its sessions. The old flat Worktrees section listed
 * checkouts and left the sessions to a tab of their own, which meant reading
 * two lists to answer one question. The focused group wears the sidebar's card
 * treatment, so "which checkout am I looking at" reads the same in both lists.
 *
 * Every session shows, finished ones included, in one recency order. The rail
 * and the sidebar are both on screen at once, so they divide by membership
 * rather than by layout: the sidebar card is what is RUNNING NOW (live
 * sessions only, `work-item-card-children.tsx`), and this is EVERYTHING THAT
 * EVER RAN. A disclosure hiding the finished ones made the map an incomplete
 * copy of the sidebar instead of the inventory it is for.
 */
export function WorktreeGroup({
  worktree,
  checkout,
  stat,
  sessions,
  summaries,
  pullRequest,
  focused,
  onFocus,
  onOpenPullRequest,
  onOpenSession,
  children,
}: {
  worktree: Worktree;
  /** Set while this lane's checkout is being created or could not be: its branch is only planned. */
  checkout: CheckoutState | null;
  stat: WorktreeStat | null;
  sessions: AgentSessionRow[];
  /** Counts and preview lines for every session of the work item, by id. */
  summaries: ReadonlyMap<string, SessionRowSummary>;
  /** Only the primary worktree carries one — `work_items.pr_number` is one per work item. */
  pullRequest: WorktreePullRequest | null;
  focused: boolean;
  onFocus: () => void;
  onOpenPullRequest: () => void;
  onOpenSession: (sessionId: string) => void;
  /** Below the lane's own sessions: what was found in its folder (`FoundSessions`). */
  children?: React.ReactNode;
}) {
  const shown = orderSessionRows(sessions);

  return (
    <div className={cn('list-card mx-1.5 my-0.5 rounded-lg')} data-active={focused}>
      <button
        type="button"
        onClick={onFocus}
        title={
          checkout === 'failed'
            ? `${worktree.branchName ?? 'This lane'}: its checkout could not be created`
            : worktree.path
        }
        className="flex h-8 w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2 text-left"
      >
        {/* Lanes of one item share the branch's head: its end tells them apart. */}
        <MiddleTruncate
          text={worktree.branchName ?? worktree.title ?? 'Worktree'}
          className={cn(
            'flex-1 text-list-row',
            focused ? 'font-medium text-text' : 'text-text-muted'
          )}
        />
        {checkout && (
          // The branch above is planned, not made: say so rather than list
          // it like a lane that exists (devstation-dd6x).
          <span
            className={cn(
              'shrink-0 rounded-xs border border-border-strong bg-surface-inset px-1.5 py-px text-list-badge font-medium',
              checkout === 'failed' ? 'text-status-warn' : 'text-text-passive'
            )}
          >
            {describeCheckoutState(checkout).badge}
          </span>
        )}
        {worktree.forkSource === 'local_copy' && (
          // The user chose to start this lane while its base couldn't be
          // fetched; it may be behind the remote, and that stays visible.
          <span
            title={`Started from a local copy of ${worktree.targetRef ?? 'its base'} — the remote could not be fetched`}
            className="shrink-0 rounded-xs border border-border-strong bg-surface-inset px-1.5 py-px text-list-badge font-medium text-status-warn"
          >
            local copy
          </span>
        )}
        {worktree.isPrimary && (
          <span className="shrink-0 rounded-xs border border-border-strong bg-surface-inset px-1.5 py-px text-list-badge font-medium text-text-muted">
            primary
          </span>
        )}
        {/* No ↑ahead here yet: the plan asks for it, but the only per-worktree
            source is a git log read, and that needs this worktree's own
            projectId — two extra RPCs per group, every poll. The band already
            states it for the focused worktree. Tracked as deferred. */}
        {stat && (stat.added > 0 || stat.removed > 0) && (
          <DiffText added={stat.added} removed={stat.removed} />
        )}
      </button>

      {(pullRequest || shown.length > 0) && (
        <div className="ml-3.5 mb-1.5 flex flex-col gap-px border-l border-border pl-2">
          {pullRequest && (
            <KidRow
              onClick={onOpenPullRequest}
              leading={
                <GitPullRequest
                  className={cn('size-icon-xs shrink-0', statusTextClass(pullRequest.signal))}
                />
              }
              title={`#${pullRequest.number} ${pullRequest.title}`}
              meta={
                <span className={statusTextClass(pullRequest.signal)}>{pullRequest.state}</span>
              }
            />
          )}

          {shown.map((session) => (
            <SessionKid
              key={session.id}
              session={session}
              summary={summaries.get(session.id) ?? null}
              onOpen={() => onOpenSession(session.id)}
            />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/** A nested row under a worktree: the PR, or one session. */
function KidRow({
  leading,
  title,
  meta,
  action,
  onClick,
}: {
  leading: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  action?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="group/kid flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-1.5 text-left transition-colors hover:bg-surface-hover"
    >
      {leading}
      <span className="min-w-0 flex-1 truncate text-list-meta text-text-muted">{title}</span>
      <span className="flex min-w-0 max-w-[60%] shrink text-list-meta text-text-passive group-hover/kid:hidden">
        {meta}
      </span>
      {action}
    </button>
  );
}

/**
 * The status word wears the `primary` badge's geometry on every row, so the
 * column lines up, but only states that ask something of the user are filled:
 * live and failed in their signal tint, suspended (resumable) in the neutral
 * badge. Ended is most of the list; filling it too would turn the column into
 * a wall of pills and drown the ones that matter.
 */
function sessionStatusPillClass(word: string, signal: StatusSignal): string {
  if (signal === 'danger') return 'border-transparent bg-status-err/15 text-status-err';
  if (signal === 'running') return 'border-transparent bg-status-running/15 text-status-running';
  if (word === ENDED_SESSION_WORD) return 'border-transparent text-text-passive';
  return 'border-border-strong bg-surface-inset text-text-muted';
}

/**
 * A session, in two lines: what it is, then what it last said and what it ran.
 *
 * Two lines rather than the PR row's one because a session title is often
 * `Claude 89fd41b3` or a shell name — not enough to pick one out of six. The
 * preview is the line that actually identifies it; the model and the count are
 * what tell two otherwise identical sessions apart.
 */
function SessionKid({
  session,
  summary,
  onOpen,
}: {
  session: AgentSessionRow;
  summary: SessionRowSummary | null;
  onOpen: () => void;
}) {
  const { live, word, signal, showAge } = sessionRowStatus(session);
  const label = labelAgentSession(session);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={summary?.preview ?? label}
      className="group/kid flex cursor-pointer flex-col gap-px rounded-md border-none bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="flex w-full items-center gap-1.5">
        {session.kind === 'terminal' ? (
          <Terminal className="size-icon-xs shrink-0 text-text-passive" />
        ) : (
          <span className="flex size-[15px] shrink-0 items-center justify-center">
            <ProviderTile providerId={session.agentProviderId} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-list-meta text-text-muted">{label}</span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-xs border px-1.5 py-px text-list-badge font-medium group-hover/kid:hidden',
            sessionStatusPillClass(word, signal)
          )}
        >
          {live && <span className="size-1.5 animate-pulse rounded-full bg-status-running" />}
          {word}
        </span>
        {!live && (
          <span
            className="hidden shrink-0 items-center rounded px-1 text-list-meta text-text-muted group-hover/kid:flex"
            aria-hidden
          >
            <Play className="size-icon-xs" />
          </span>
        )}
      </span>

      {summary?.preview && (
        <span className="w-full truncate pl-[21px] text-list-meta text-text-passive">
          {summary.preview}
        </span>
      )}

      <span className="flex w-full items-center gap-1 truncate pl-[21px] text-list-meta text-text-passive">
        {showAge && <RelativeTime value={session.lastActiveAt * 1000} compact />}
        {/* A real 0 for a session that has said nothing. The map lists LOCAL
            sessions, whose messages are written locally under their own id, so
            the count is always knowable — there is no "unknown" to render. A
            terminal holds no messages at all, so it has no count to show. */}
        {summary && session.kind !== 'terminal' && (
          <>
            {showAge && ' · '}
            {summary.messageCount} msg{summary.messageCount === 1 ? '' : 's'}
          </>
        )}
        {/* What this session ACTUALLY launched with. Absent when the column is
            null — never launched, a terminal, or running the provider's own
            default — and never the work item's model, which is a default
            rather than a record of this run. */}
        {session.model && (
          <>
            {' · '}
            <span className="min-w-0 truncate">{session.model}</span>
          </>
        )}
      </span>
    </button>
  );
}
