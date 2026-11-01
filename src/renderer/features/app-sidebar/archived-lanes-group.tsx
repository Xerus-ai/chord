import { Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ArchivedLane } from '@shared/worktrees';
import { describeArchivedLane } from './lane-archive-model';

function ArchivedLaneRow({
  lane,
  onRestore,
  onDelete,
}: {
  lane: ArchivedLane;
  onRestore: (laneId: string) => Promise<void>;
  onDelete: (laneId: string) => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { label, detail, canRestore } = describeArchivedLane(lane);

  const restore = async () => {
    setRestoring(true);
    setError(null);
    try {
      await onRestore(lane.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div data-archived-lane={lane.id} className="flex flex-col gap-0.5 rounded-md px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <Archive className="h-3 w-3 shrink-0 text-text-passive" />
        <span
          className="min-w-0 flex-1 truncate text-list-meta text-text-muted"
          title={lane.branchName ?? undefined}
        >
          {label}
        </span>
        {canRestore && (
          <button
            type="button"
            disabled={restoring}
            onClick={() => void restore()}
            className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-list-meta text-text-muted hover:text-text hover:underline disabled:cursor-default"
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        )}
        <button
          type="button"
          disabled={restoring}
          onClick={() => onDelete(lane.id)}
          className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-list-meta text-text-muted hover:text-status-err hover:underline disabled:cursor-default"
        >
          Delete
        </button>
      </div>
      <span className="pl-5 text-tiny tracking-tiny text-text-passive">{detail}</span>
      {error && <span className="pl-5 text-tiny tracking-tiny text-status-err">{error}</span>}
    </div>
  );
}

/**
 * A work item's archived lanes (plan §"Decisions for Phase 5", Restore):
 * collapsed to "Archived (n)" under its live lanes; each row offers Restore
 * and Delete, or Delete only once its branch is gone.
 */
export function ArchivedLanesGroup({
  lanes,
  onRestore,
  onDelete,
}: {
  lanes: readonly ArchivedLane[];
  onRestore: (laneId: string) => Promise<void>;
  onDelete: (laneId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (lanes.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        className="flex cursor-pointer items-center gap-1 border-none bg-transparent px-2 py-1 text-left text-list-meta text-text-passive hover:text-text-muted"
      >
        <Chevron className="h-3 w-3 shrink-0" />
        {`Archived (${lanes.length})`}
      </button>
      {open &&
        lanes.map((lane) => (
          <ArchivedLaneRow key={lane.id} lane={lane} onRestore={onRestore} onDelete={onDelete} />
        ))}
    </div>
  );
}
