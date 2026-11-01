import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  AGENT_SESSION_MODES,
  REPO_ORDER_VALUES,
  ROW_LAYOUT_VALUES,
  SORT_BY_VALUES,
  UNSUPPORTED_AGENT_SESSIONS,
  UNSUPPORTED_REPO_ORDER,
  type AgentSessionMode,
  type RepoOrder,
  type RowLayout,
  type RowPropertyKey,
  type SortBy,
  type UnsupportedReason,
} from './sidebar-options-model';

/** One sentence per reason code, so the model never carries user-facing copy. */
export const REASON_COPY: Record<UnsupportedReason, string> = {
  no_tickets_in_summaries: 'Needs linked tickets on the sidebar summary.',
  no_participants_on_local_items: 'Participants are only known for shared work items.',
  no_artifact_count_in_summaries: 'Needs an artifact count on the sidebar summary.',
  no_suspended_sessions_in_summaries: 'Only live sessions reach the sidebar today.',
  no_archived_worktrees_in_summaries: 'Archived worktrees are not reported to the sidebar.',
  manual_repo_drag_not_built: 'Dragging repo headers is not built yet.',
};

export const LABELS = {
  sortBy: { attention: 'Attention', recent: 'Recent', name: 'Name', created: 'Created' },
  repoOrder: { recent: 'Recent', name: 'Name', manual: 'Manual' },
  rowLayout: { compact: 'Compact', detailed: 'Detailed' },
  agentSessions: { off: 'Off', live: 'Live only', full: 'Full list' },
  properties: {
    diffStat: 'Diff stat',
    pr: 'PR',
    ticket: 'Ticket',
    branch: 'Branch',
    participants: 'Participants',
    devServer: 'Dev server',
    artifactCount: 'Artifacts count',
  } satisfies Record<RowPropertyKey, string>,
} as const;

/** The single-choice drill-in sections — root row label, its values and their
 * copy, and which values today's data cannot support. */
export const SINGLE_CHOICE_SECTIONS = {
  sortBy: { label: 'Sort by', values: SORT_BY_VALUES, labels: LABELS.sortBy, unsupported: {} },
  repoOrder: {
    label: 'Repo order',
    values: REPO_ORDER_VALUES,
    labels: LABELS.repoOrder,
    unsupported: UNSUPPORTED_REPO_ORDER,
  },
  rowLayout: {
    label: 'Row layout',
    values: ROW_LAYOUT_VALUES,
    labels: LABELS.rowLayout,
    unsupported: {},
  },
  agentSessions: {
    label: 'Agent sessions',
    values: AGENT_SESSION_MODES,
    labels: LABELS.agentSessions,
    unsupported: UNSUPPORTED_AGENT_SESSIONS,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    values: readonly string[];
    labels: Record<string, string>;
    unsupported: Partial<Record<string, UnsupportedReason>>;
  }
>;

export type SingleChoiceKey = keyof typeof SINGLE_CHOICE_SECTIONS;
export type DrillView = 'root' | SingleChoiceKey | 'repos' | 'properties';

export interface OptionsDrillState {
  sortBy: SortBy;
  repoOrder: RepoOrder;
  rowLayout: RowLayout;
  agentSessions: AgentSessionMode;
}

/** A root-view row that opens a drill-in view: current value + a chevron. */
export function DrillRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-tiny tracking-tiny font-medium text-text transition-colors hover:bg-surface-raised"
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="truncate text-text-passive">{value}</span>
      <ChevronRight className="size-icon-xs shrink-0 text-text-passive" strokeWidth={1.75} />
    </button>
  );
}

/** The drill-in view's own header: back to root, with the section's name. */
export function DrillBackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-tiny tracking-tiny font-semibold text-text transition-colors hover:bg-surface-raised"
    >
      <ChevronLeft className="size-icon-xs text-text-passive" strokeWidth={1.75} />
      {label}
    </button>
  );
}

/** One selectable row inside a drill-in view — a check for a single choice
 * that returns to root on pick, a switch for a multi-choice that stays open.
 * Unsupported rows stay visible, disabled, with their reason as a tooltip. */
export function DrillChoiceRow({
  label,
  leading,
  selected,
  multi,
  unsupportedReason,
  onSelect,
}: {
  label: string;
  leading?: React.ReactNode;
  selected: boolean;
  multi: boolean;
  unsupportedReason?: UnsupportedReason;
  onSelect: () => void;
}) {
  const row = (
    <button
      type="button"
      disabled={Boolean(unsupportedReason)}
      onClick={onSelect}
      className={cn(
        'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-tiny tracking-tiny',
        unsupportedReason
          ? 'cursor-default text-text-passive'
          : 'text-text-muted transition-colors hover:bg-surface-raised hover:text-text'
      )}
    >
      {leading}
      <span className="flex-1 truncate">{label}</span>
      {multi ? (
        <Switch checked={selected} disabled={Boolean(unsupportedReason)} />
      ) : (
        selected && <Check className="size-icon-xs text-text" strokeWidth={1.75} />
      )}
    </button>
  );

  if (!unsupportedReason) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{row}</TooltipTrigger>
      <TooltipContent side="left">{REASON_COPY[unsupportedReason]}</TooltipContent>
    </Tooltip>
  );
}

/** A filter row on the root view: leading icon, label, and a switch. */
export function FilterRow({
  icon,
  label,
  checked,
  unsupportedReason,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  unsupportedReason?: UnsupportedReason;
  onCheckedChange: (next: boolean) => void;
}) {
  const row = (
    <button
      type="button"
      disabled={Boolean(unsupportedReason)}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-tiny tracking-tiny',
        unsupportedReason
          ? 'cursor-default text-text-passive'
          : 'text-text-muted transition-colors hover:bg-surface-raised hover:text-text'
      )}
    >
      <span className="flex shrink-0 text-text-passive">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <Switch checked={checked} disabled={Boolean(unsupportedReason)} />
    </button>
  );

  if (!unsupportedReason) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{row}</TooltipTrigger>
      <TooltipContent side="left">{REASON_COPY[unsupportedReason]}</TooltipContent>
    </Tooltip>
  );
}
