import { AlertTriangle, RotateCw } from 'lucide-react';

interface ArtifactLoadErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Shown above the editor when the artifact's body could not be read. It sits
 * over the document rather than replacing it, because a collaborative artifact
 * may still hold real content from the collab server even when the file behind
 * it is unreadable — but an empty editor must never be the only thing a failed
 * read produces.
 */
export function ArtifactLoadError({ message, onRetry }: ArtifactLoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-shrink-0 items-center gap-2 border-b border-status-err-border bg-status-err-bg px-4 py-2 text-tiny tracking-tiny text-status-err"
    >
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-[26px] flex-shrink-0 cursor-pointer items-center gap-1 rounded-md border border-status-err-border bg-status-err-bg-strong px-2 text-tiny tracking-tiny font-semibold text-status-err transition-colors hover:bg-status-err-bg"
      >
        <RotateCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}
