import {
  ChevronDown,
  ChevronRight,
  Circle,
  Minus,
  Plus,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { GitChange } from '@shared/git';
import type { SourceControlGroupOrder } from '@shared/git-settings';
import { ViewerChips } from '@renderer/features/work-list/file-row';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { cn } from '@renderer/utils/utils';
import { FileGlyph } from '../file-icon';
import { RailEmpty } from '../rail-primitives';
import {
  buildChangesTree,
  type ChangesTreeInput,
  type FileRow,
  type FolderRow,
  type GroupRow,
} from './changes-tree';

/** The change-status square: a hairline box around a glyph in the status colour. */
const STATUS_GLYPH: Record<GitChange['status'], { icon: LucideIcon; tone: string }> = {
  added: { icon: Plus, tone: 'text-status-ok' },
  modified: { icon: Circle, tone: 'text-status-warn' },
  deleted: { icon: Minus, tone: 'text-status-err' },
  renamed: { icon: Circle, tone: 'text-status-merged' },
  conflicted: { icon: Circle, tone: 'text-status-err' },
};

const INDENT_PX = 12;

/**
 * The changed files as one tree: Conflicts, Changes, Staged and Untracked as
 * top-level groups in the order Settings › Git chose, folders carrying their
 * own summed totals, files underneath.
 *
 * Which rows exist is `changes-tree.ts`'s job. This renders them and owns the
 * one piece of state a tree needs — which nodes are closed.
 */
/** What a row can do to the working tree. Committed changes offer none: they are history. */
export interface ChangesRowActions {
  busy: boolean;
  onStage: (filePath: string) => void;
  onUnstage: (filePath: string) => void;
  onDiscard: (filePath: string) => void;
}

export function ChangesTreeView({
  changes,
  groupOrder,
  viewers,
  selectedFile,
  onOpenDiff,
  actions,
}: {
  changes: ChangesTreeInput;
  groupOrder: SourceControlGroupOrder;
  viewers: WorkItemViewer[];
  selectedFile: string | null;
  onOpenDiff: (filePath: string) => void;
  /** Null for the committed view: Stage and Discard mean nothing for a commit. */
  actions: ChangesRowActions | null;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const rows = useMemo(
    () => buildChangesTree(changes, collapsed, groupOrder),
    [changes, collapsed, groupOrder]
  );

  const viewersByFile = useMemo(() => {
    const byFile = new Map<string, WorkItemViewer[]>();
    for (const viewer of viewers) {
      const list = byFile.get(viewer.file);
      if (list) list.push(viewer);
      else byFile.set(viewer.file, [viewer]);
    }
    return byFile;
  }, [viewers]);

  if (rows.length === 0) return <RailEmpty>No changes</RailEmpty>;

  return (
    <div className="flex flex-col py-1">
      {rows.map((row) =>
        row.kind === 'file' ? (
          <FileTreeRow
            key={row.id}
            row={row}
            viewers={viewersByFile.get(row.path)}
            selected={selectedFile === row.path}
            onOpenDiff={onOpenDiff}
            actions={actions}
          />
        ) : (
          <BranchTreeRow key={row.id} row={row} onToggle={() => toggle(row.id)} />
        )
      )}
    </div>
  );
}

/** A group header or a folder: a chevron, a name, and the totals beneath it. */
function BranchTreeRow({ row, onToggle }: { row: GroupRow | FolderRow; onToggle: () => void }) {
  const isGroup = row.kind === 'group';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!row.collapsed}
      style={{ paddingLeft: 8 + row.depth * INDENT_PX }}
      className="group flex h-7 cursor-pointer items-center gap-1.5 border-none bg-transparent pr-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      {row.collapsed ? (
        <ChevronRight className="size-icon-xs shrink-0 text-text-passive" />
      ) : (
        <ChevronDown className="size-icon-xs shrink-0 text-text-passive" />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          isGroup
            ? 'text-list-meta font-semibold uppercase tracking-list-label text-text-passive'
            : 'text-list-row text-text-muted'
        )}
      >
        {row.name}
      </span>
      {isGroup ? (
        <span className="shrink-0 text-list-meta tabular-nums text-text-passive">{row.count}</span>
      ) : (
        <Totals added={row.added} removed={row.removed} dim />
      )}
    </button>
  );
}

function FileTreeRow({
  row,
  viewers,
  selected,
  onOpenDiff,
  actions,
}: {
  row: FileRow;
  viewers: WorkItemViewer[] | undefined;
  selected: boolean;
  onOpenDiff: (filePath: string) => void;
  actions: ChangesRowActions | null;
}) {
  const { icon: StatusIcon, tone } = STATUS_GLYPH[row.status];

  return (
    <div
      data-active={selected}
      style={{ paddingLeft: 8 + row.depth * INDENT_PX }}
      className="list-card group flex h-7 items-center gap-1.5 rounded-md pr-2.5"
    >
      <button
        type="button"
        onClick={() => onOpenDiff(row.path)}
        title={row.path}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left"
      >
        <FileGlyph fileName={row.name} gitStatus={row.status} />
        <span className="min-w-0 flex-1 truncate text-list-row text-text">{row.name}</span>
      </button>

      <Totals added={row.added} removed={row.removed} />
      {viewers && viewers.length > 0 && <ViewerChips viewers={viewers} />}

      {/* The square states the change; hovering swaps it for the two things
          you can do about it, so a quiet row stays quiet (prototype `.tr`). */}
      <span
        aria-label={row.status}
        title={row.status}
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-current',
          actions && 'group-hover:hidden',
          tone
        )}
      >
        <StatusIcon
          className={StatusIcon === Circle ? 'size-1.5 fill-current' : 'size-2.5'}
          strokeWidth={StatusIcon === Circle ? 0 : 2.5}
        />
      </span>
      {actions && <FileRowActions row={row} actions={actions} />}
    </div>
  );
}

function FileRowActions({ row, actions }: { row: FileRow; actions: ChangesRowActions }) {
  const showConfirm = useShowModal('confirmActionModal');
  const confirmDiscard = () =>
    showConfirm({
      title: `Discard changes to ${row.name}?`,
      description: `This restores ${row.path} to its last committed state. The changes are not recoverable from Chord.`,
      confirmLabel: 'Discard',
      variant: 'destructive',
      onSuccess: () => actions.onDiscard(row.path),
    });

  return (
    <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
      <RowAction
        label={
          row.canDiscard
            ? `Discard changes to ${row.name}`
            : 'Resolve the conflict before discarding this file'
        }
        disabled={actions.busy || !row.canDiscard}
        onClick={confirmDiscard}
      >
        <Undo2 className="size-icon-xs" />
      </RowAction>
      {row.group === 'staged' ? (
        <RowAction
          label={`Unstage ${row.name}`}
          disabled={actions.busy}
          onClick={() => actions.onUnstage(row.path)}
        >
          <Minus className="size-icon-xs" />
        </RowAction>
      ) : (
        <RowAction
          label={`Stage ${row.name}`}
          disabled={actions.busy}
          onClick={() => actions.onStage(row.path)}
        >
          <Plus className="size-icon-xs" />
        </RowAction>
      )}
    </span>
  );
}

function Totals({ added, removed, dim }: { added: number; removed: number; dim?: boolean }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 font-mono text-list-meta tabular-nums',
        dim && 'opacity-75'
      )}
    >
      {added > 0 && <span className="text-diff-add">+{added}</span>}
      {removed > 0 && <span className="text-diff-del">-{removed}</span>}
    </span>
  );
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex cursor-pointer items-center justify-center rounded-xs border-none bg-transparent p-0.5 text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted disabled:cursor-default disabled:text-text-disabled disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
