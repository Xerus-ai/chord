import {
  Archive,
  ArrowUpToLine,
  Copy,
  MoreVertical,
  SquareArrowOutUpRight,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { SidebarWorktreeSummary } from '@shared/sidebar-summaries';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { FittedLaneLabel } from './fitted-lane-label';
import { formatLaneRoute, planLaneRowActions, type LaneAction } from './lane-row-model';
import type { LaneActions } from './use-lane-actions';

export interface LaneRowHandlers extends LaneActions {
  onCopyBranch: (branchName: string) => void;
}

/**
 * Where the lane merges is always on the row: "branch → target" (plan P16).
 * The sidebar's Branch property decides only whether a titled lane leads
 * with its title or with the branch alone.
 */
export function LaneLabel({
  lane,
  showBranch,
}: {
  lane: SidebarWorktreeSummary;
  showBranch: boolean;
}) {
  const route = formatLaneRoute(lane);
  if (lane.branch === null || route === null) {
    return <span className="min-w-0 flex-1 truncate">{lane.title ?? 'No branch recorded'}</span>;
  }
  // The branch's end, then the target, keep their room; the title and the
  // branch's head give theirs up first (`fit-lane-label.ts`). The tooltip
  // has every part, the title too, since a narrow row may not show it.
  const title = showBranch ? null : lane.title;
  return (
    <FittedLaneLabel
      title={title}
      branch={lane.branch}
      suffix={lane.targetRef === null ? null : ` → ${lane.targetRef}`}
      tooltip={title ? `${title}\n${route}` : route}
    />
  );
}

/** An action shown disabled carries its reason as a second line, not only a tooltip. */
function ActionLabel({ label, action }: { label: string; action: LaneAction }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      {!action.enabled && (
        <span className="text-tiny tracking-tiny text-text-passive">{action.reason}</span>
      )}
    </span>
  );
}

/**
 * The kebab and a right-click open the same menu (as on work item rows), so
 * the kebab re-fires the lane row's own context-menu event.
 */
function openLaneMenu(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation();
  const row = event.currentTarget.closest('[data-lane-row]');
  if (!row) return;
  const { bottom, left } = event.currentTarget.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: left,
      clientY: bottom,
    })
  );
}

export function LaneActionsButton() {
  return (
    <button
      type="button"
      aria-label="Branch actions"
      onClick={openLaneMenu}
      className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity group-hover/lane:opacity-100 hover:bg-surface-inset hover:text-text focus-visible:opacity-100"
    >
      <MoreVertical className="size-icon-xs" />
    </button>
  );
}

/**
 * One lane row's menu and identity. A click opens the work item focused on
 * the lane. The row sits inside its work item's own context-menu trigger, so
 * its right-click stops there rather than opening both menus.
 */
export function LaneRowMenu({
  workItemId,
  lane,
  isFocused,
  handlers,
  className,
  children,
}: {
  workItemId: string;
  lane: SidebarWorktreeSummary;
  isFocused: boolean;
  handlers: LaneRowHandlers;
  className: string;
  children: ReactNode;
}) {
  const actions = planLaneRowActions(lane);
  const branch = lane.branch;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            data-lane-row={lane.id}
            data-primary={lane.isPrimary}
            data-focused={isFocused}
            onContextMenu={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              handlers.onOpenLane(workItemId, lane);
            }}
            // The focused mark goes last: the caller's own text colour and
            // hover wash would otherwise win the merge and mute it (qm7).
            className={cn(
              'group/lane',
              className,
              isFocused && 'bg-lane-focused-bg text-text hover:bg-lane-focused-bg'
            )}
          />
        }
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => handlers.onOpenLane(workItemId, lane)}>
          <SquareArrowOutUpRight />
          Open
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!actions.promote.enabled}
          onClick={() => handlers.onPromoteLane(workItemId, lane)}
        >
          <ArrowUpToLine />
          <ActionLabel label="Promote to primary" action={actions.promote} />
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!actions.copyBranch.enabled}
          onClick={() => branch !== null && handlers.onCopyBranch(branch)}
        >
          <Copy />
          <ActionLabel label="Copy branch" action={actions.copyBranch} />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!actions.archive.enabled}
          onClick={() => handlers.onArchiveLane(workItemId, lane)}
        >
          <Archive />
          <ActionLabel label="Archive" action={actions.archive} />
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={!actions.delete.enabled}
          onClick={() => handlers.onDeleteLane(workItemId, lane)}
        >
          <Trash2 />
          <ActionLabel label="Delete" action={actions.delete} />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
