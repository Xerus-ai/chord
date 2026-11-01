import { FileDiff, X } from 'lucide-react';

interface AgentUpdateBannerProps {
  filePath: string;
  onApply: () => void;
  onDismiss: () => void;
}

/**
 * Shown when an agent rewrote the artifact's file while the document already had
 * content. The document — not the file — is the source of truth, so the write is
 * never applied behind the user's back: applying it is an explicit, and shared,
 * decision because it replaces the document for every collaborator.
 */
export function AgentUpdateBanner({ filePath, onApply, onDismiss }: AgentUpdateBannerProps) {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;

  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-inset px-4 py-2 text-tiny tracking-tiny text-text-muted">
      <FileDiff className="h-3.5 w-3.5 flex-shrink-0 text-text-passive" />
      <span className="min-w-0 flex-1 truncate">
        The agent updated <span className="font-semibold text-text">{fileName}</span> — applying
        replaces this document for everyone editing it.
      </span>
      <button
        type="button"
        onClick={onApply}
        className="inline-flex h-[26px] flex-shrink-0 cursor-pointer items-center rounded-md border border-border bg-surface-hover-solid px-2 text-tiny tracking-tiny font-semibold text-text transition-colors hover:border-border-strong"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        className="flex h-[26px] w-[26px] flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-passive transition-colors hover:bg-surface-hover-solid hover:text-text-muted"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
