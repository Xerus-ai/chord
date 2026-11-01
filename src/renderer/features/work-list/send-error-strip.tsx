import { X } from 'lucide-react';

/** A dismissible delivery failure pinned above a composer. */
export function SendErrorStrip({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex max-w-[600px] items-start gap-2 rounded-sm border border-status-err/30 bg-status-err/5 px-3 py-2">
      <span className="flex-1 text-tiny tracking-tiny text-status-err">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent text-status-err hover:opacity-70"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
