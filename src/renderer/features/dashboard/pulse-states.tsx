import { AlertTriangle, Key, Loader2, RefreshCw } from 'lucide-react';
import React from 'react';
import { cn } from '@renderer/utils/utils';

/** Outcome of the last explicit "generate pulse" run, shown inline. */
export type GenerateStatus = { tone: 'error' | 'info'; message: string };

/** Subtle header affordance: the poll failed but stale content is still on screen. */
export function StaleIndicator({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      title={`Last refresh failed: ${message}`}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-micro tracking-micro text-status-err transition-colors hover:bg-status-err-bg"
    >
      <AlertTriangle className="h-3 w-3" />
      Stale
    </button>
  );
}

export function GenerateStatusMessage({ status }: { status: GenerateStatus }) {
  return (
    <p
      className={cn(
        'break-words text-tiny tracking-tiny leading-relaxed',
        status.tone === 'error' ? 'text-status-err' : 'text-text-passive'
      )}
    >
      {status.message}
    </p>
  );
}

export function AiDisabledState({ onAction }: { onAction?: (key: string) => void }) {
  return (
    <div className="p-5">
      <h3 className="mb-4 section-header">Team Pulse</h3>
      <div className="rounded-lg border border-border-subtle bg-surface-inset p-4">
        <div className="flex items-center gap-2 text-body tracking-body font-medium text-text">
          <Key className="h-4 w-4 text-text-passive" />
          AI summaries disabled
        </div>
        <p className="mt-2 text-tiny tracking-tiny leading-relaxed text-text-passive">
          Add your OpenRouter API key to enable AI-generated team activity summaries. Calls are
          billed to your own OpenRouter account.
        </p>
        <button
          type="button"
          onClick={() => onAction?.('open-settings-integrations')}
          className="mt-3 rounded-md bg-action-bg px-3 py-2 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover"
        >
          Add API key
        </button>
      </div>
    </div>
  );
}

export function EmptyPulseState({
  generating,
  onGenerate,
  status,
}: {
  generating: boolean;
  onGenerate: () => void;
  status: GenerateStatus | null;
}) {
  return (
    <div className="p-5">
      <div className="rounded-lg border border-action-bg/[0.15] bg-action-bg/[0.05] p-4">
        <p className="text-body tracking-body font-semibold text-text">No summaries yet</p>
        <p className="mt-1 text-tiny tracking-tiny leading-relaxed text-text-passive">
          Generate AI-powered activity summaries for your team.
        </p>
        {status && (
          <div className="mt-2">
            <GenerateStatusMessage status={status} />
          </div>
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mt-3 flex items-center gap-1 rounded-md bg-action-bg px-3 py-2 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          {generating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              {status?.tone === 'error' ? 'Try again' : 'Generate Pulse'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function QuickLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-body tracking-body text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
