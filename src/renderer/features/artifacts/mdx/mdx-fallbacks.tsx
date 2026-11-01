interface MdxErrorFallbackProps {
  error: string;
  onDelete?: () => void;
}

export function MdxErrorFallback({ error, onDelete }: MdxErrorFallbackProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-status-err-border bg-status-err-bg p-4">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-status-err">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
        <span className="text-body tracking-body font-medium text-status-err">Component Error</span>
      </div>
      <pre className="max-h-32 overflow-auto rounded bg-status-err-bg-strong p-2 text-tiny tracking-tiny text-status-err">
        {error}
      </pre>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="self-start rounded border border-status-err-border bg-status-err-bg-strong px-3 py-1 text-tiny tracking-tiny font-medium text-status-err transition-colors hover:bg-status-err-bg"
        >
          Remove component
        </button>
      )}
    </div>
  );
}

export function MdxLoading() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-surface-raised p-6">
      <div className="flex items-center gap-2 text-body tracking-body text-text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-25"
          />
          <path
            d="M4 12a8 8 0 018-8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="opacity-75"
          />
        </svg>
        Bundling component...
      </div>
    </div>
  );
}
