import { CheckCircle, GitMerge, X } from 'lucide-react';

/** Offered above the centre once the item's PR merges, until marked done or dismissed. */
export function PrMergedBanner({
  prNumber,
  onMarkDone,
  onDismiss,
}: {
  prNumber?: number | null;
  onMarkDone: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-status-ok/20 bg-status-ok/[0.06] px-5 py-2">
      <GitMerge className="h-4 w-4 shrink-0 text-status-merged" />
      <span className="flex-1 text-body tracking-body text-text-muted">
        PR{prNumber ? ` #${prNumber}` : ''} has been merged.
      </span>
      <button
        onClick={onMarkDone}
        className="flex items-center gap-1 rounded-md bg-status-ok px-3 py-1 text-tiny tracking-tiny font-semibold text-action-fg transition-[filter] duration-100 hover:brightness-110 active:scale-[0.97]"
      >
        <CheckCircle className="h-3 w-3" />
        Mark done
      </button>
      <button
        onClick={onDismiss}
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
