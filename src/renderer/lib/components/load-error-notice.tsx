import { AlertTriangle, RefreshCw } from 'lucide-react';

/** Turns a rejected IPC/fetch value into text worth showing the user. */
export function describeLoadError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Unknown error.';
}

export function LoadErrorNotice({
  title,
  message,
  retryLabel = 'Retry',
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-status-err-border bg-status-err-bg p-4">
      <div className="flex items-center gap-2 text-body tracking-body font-semibold text-status-err">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </div>
      <p className="mt-1 break-words text-tiny tracking-tiny leading-relaxed text-text-passive">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 flex items-center gap-1 rounded-md border border-border px-3 py-2 text-tiny tracking-tiny font-semibold text-text-muted transition-colors hover:bg-status-err-bg-strong hover:text-text"
        >
          <RefreshCw className="h-3 w-3" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
