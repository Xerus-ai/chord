import { X } from 'lucide-react';

/** Said in place when a notification's message cannot be shown (step 5, decision 4). */
export const REVEAL_NOT_FOUND = 'Couldn’t find that message.';

/**
 * Above a transcript, outside its scroll: the message a notification pointed
 * at is not in this chat, so the reader is told rather than left wherever the
 * transcript happened to be.
 */
export function RevealNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      data-testid="reveal-notice"
      className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-5 py-2"
    >
      <span className="min-w-0 flex-1 text-tiny tracking-tiny text-text-muted">
        {REVEAL_NOT_FOUND}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs border-none bg-transparent text-text-passive hover:bg-surface-hover hover:text-text"
      >
        <X className="size-icon-xs" />
      </button>
    </div>
  );
}
