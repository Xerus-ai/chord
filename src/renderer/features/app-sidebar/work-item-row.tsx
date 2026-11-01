import { ChevronRight, GitPullRequest } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RepoIcon } from '@shared/repo-icons';
import { checkoutStateOf, describeCheckoutState } from '@shared/work-item-checkout-state';
import { DiffText } from '@renderer/lib/components/diff-counts';
import { cn } from '@renderer/utils/utils';
import { needsYouLabel } from './needs-you-label';
import { RepoIdentityTile } from './repo-identity-tile';
import { getStatusWord, getTrailingSlot, type TrailingSlot } from './row-presentation';
import type { RowLayout } from './sidebar-options-model';
import type { SidebarItem, SidebarView } from './sidebar-projection';
import { WorkItemRowDetailed } from './work-item-row-detailed';
import { WorkItemRowLeading } from './work-item-row-leading';
import {
  ArtifactCount,
  CompareCueText,
  MetaFacts,
  RowActionsButton,
  RowTime,
  RowTitle,
  RunningChip,
  StatusWordText,
} from './work-item-row-parts';

export interface WorkItemRowProps {
  item: SidebarItem;
  view: SidebarView;
  /** The repo's chosen icon, for the Status-view repo tile. Null = letter. */
  repoIcon: RepoIcon | null;
  isActive: boolean;
  isExpanded: boolean;
  /** Only rows with more than one worktree or a live session can expand. */
  isExpandable: boolean;
  layout: RowLayout;
  showDiffStat: boolean;
  showPullRequest: boolean;
  /** Needs You rows trade the status word for the reason that put them there. */
  showNeedsYouReason?: boolean;
  /** Extra left inset for rows nested under a repo header. */
  indented?: boolean;
  /** 1-based position among the visible rows, or null past the ninth. */
  jumpIndex?: number | null;
  onOpen: (workItemId: string) => void;
  onToggleExpanded: (workItemId: string) => void;
  /** The active card's nested worktrees and sessions, rendered inside it. */
  children?: ReactNode;
}

/**
 * The diff stat is an option; a row that may not show one falls back to its
 * time — and so does the reason it has none, which only stands in for it.
 */
function resolveTrailingSlot(item: SidebarItem, showDiffStat: boolean): TrailingSlot {
  const slot = getTrailingSlot(item);
  const isCount = slot.kind === 'diff' || slot.kind === 'compare_cue';
  return isCount && !showDiffStat ? { kind: 'time' } : slot;
}

function TrailingSlotVisual({ item, slot }: { item: SidebarItem; slot: TrailingSlot }) {
  if (slot.kind === 'running') return <RunningChip liveSessionCount={slot.liveSessionCount} />;
  if (slot.kind === 'diff') return <DiffText added={slot.added} removed={slot.removed} />;
  if (slot.kind === 'compare_cue') return <CompareCueText cue={slot.cue} />;
  return <RowTime item={item} />;
}

/**
 * Compact — the prototype's `rowC`. One line: leading glyph, title, and a
 * trailing slot that swaps for the row's actions on hover. The active item
 * earns a second line; every other row stays one line tall, which is what
 * keeps the list from reflowing as agents start and stop.
 *
 * A row whose checkout is being created, or could not be, says so in place
 * of its meta facts: there is no branch, no PR and no status to report until
 * its checkout exists.
 */
function WorkItemRowCompact({
  item,
  view,
  repoIcon,
  isActive,
  hovered,
  showDiffStat,
  showPullRequest,
  reason,
}: {
  item: SidebarItem;
  view: SidebarView;
  repoIcon: RepoIcon | null;
  isActive: boolean;
  hovered: boolean;
  showDiffStat: boolean;
  showPullRequest: boolean;
  reason: string | null;
}) {
  const status = getStatusWord(item);
  const slot = resolveTrailingSlot(item, showDiffStat);
  const checkout = item.provisionStatus === null ? null : checkoutStateOf(item.provisionStatus);

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex h-[18px] items-center gap-1.5">
        <RowTitle item={item} />
        {hovered ? (
          <RowActionsButton />
        ) : item.sharedArtifacts ? (
          <ArtifactCount count={item.sharedArtifacts.length} />
        ) : (
          <TrailingSlotVisual item={item} slot={slot} />
        )}
        {/* Status view groups by band, so the repo is the fact the row is
            missing — a fixed right-hand column, never a word in the title. */}
        {view === 'status' && (
          <RepoIdentityTile
            repoId={item.repoId}
            label={item.repoLabel}
            icon={repoIcon}
            className="size-icon-sm rounded-xs"
          />
        )}
      </span>

      {isActive && (
        <span className="flex h-[15px] items-center gap-1.5 overflow-hidden text-list-meta text-text-passive">
          {checkout ? (
            <span className={cn(checkout === 'failed' && 'text-status-warn')}>
              {describeCheckoutState(checkout).rowText}
            </span>
          ) : item.ownedByAnotherAccount ? (
            <span className="min-w-0 truncate">Not synced · belongs to another account</span>
          ) : (
            <MetaFacts
              parts={[
                item.branchName,
                (status || reason) && <StatusWordText status={status} reason={reason} />,
                showPullRequest && item.pullRequest && (
                  <span className="flex items-center gap-1">
                    <GitPullRequest className="size-icon-xs" strokeWidth={1.75} />#
                    {item.pullRequest.number}
                  </span>
                ),
              ]}
            />
          )}
          <span className="ml-auto shrink-0 pl-1.5">
            <RowTime item={item} />
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * One work item as a card. Selection is a brighter border plus a
 * translucent wash (`.list-card[data-active]`), not an opaque fill, and
 * the active item's worktrees and sessions live *inside* that border — the
 * card is the boundary of "what you are working on", so nesting them outside
 * it made the selection stop where the detail began.
 */
export function WorkItemRow({
  item,
  view,
  repoIcon,
  isActive,
  isExpanded,
  isExpandable,
  layout,
  showDiffStat,
  showPullRequest,
  showNeedsYouReason = false,
  indented = false,
  jumpIndex = null,
  onOpen,
  onToggleExpanded,
  children,
}: WorkItemRowProps) {
  const [hovered, setHovered] = useState(false);
  const reason = showNeedsYouReason ? needsYouLabel(item.needsYou) : null;

  // The chevron takes over the leading slot on hover rather than claiming a
  // column of its own: an always-present chevron on rows that mostly cannot
  // expand is a column of nothing.
  const showChevron = !isActive && isExpandable && hovered;

  return (
    <div
      data-sidebar-row
      data-active={isActive}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="list-card group mb-0.5 select-none rounded-lg transition-[background-color,border-color,box-shadow] duration-200"
    >
      <span
        onClick={() => onOpen(item.id)}
        className={cn(
          'flex cursor-pointer items-start gap-2 rounded-lg py-1.5 pr-2',
          indented ? 'pl-4' : 'pl-1.5'
        )}
      >
        {showChevron ? (
          <button
            type="button"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded(item.id);
            }}
            className="flex size-[18px] shrink-0 items-center justify-center"
          >
            <ChevronRight
              className={cn(
                'size-icon-xs text-text-muted transition-transform duration-150',
                isExpanded && 'rotate-90'
              )}
            />
          </button>
        ) : (
          <WorkItemRowLeading item={item} view={view} />
        )}

        {layout === 'detailed' ? (
          <WorkItemRowDetailed
            item={item}
            showDiffStat={showDiffStat}
            reason={reason}
            jumpIndex={jumpIndex}
          />
        ) : (
          <WorkItemRowCompact
            item={item}
            view={view}
            repoIcon={repoIcon}
            isActive={isActive}
            hovered={hovered}
            showDiffStat={showDiffStat}
            showPullRequest={showPullRequest}
            reason={reason}
          />
        )}
      </span>

      {children}
    </div>
  );
}
