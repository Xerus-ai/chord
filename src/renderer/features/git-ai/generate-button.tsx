import { Loader2, Sparkles, X } from 'lucide-react';
import type { GitAiAgent } from '@shared/git-ai';
import { cn } from '@renderer/utils/utils';
import type { GitAiFailureView } from './describe-git-ai-failure';
import { describeGenerateButton } from './generate-button-state';
import { useGitAiAgentStatus } from './use-git-ai';

/**
 * "Generate" for a commit message or a PR's title and body, with the user's
 * own agent (Settings › Git › AI). Disabled, naming the agent, when it can't
 * answer; Cancel while it runs.
 */
export function GenerateButton({
  agent,
  generating,
  onGenerate,
  onCancel,
  className,
}: {
  /** Null while Settings › Git › AI is being read. */
  agent: GitAiAgent | null;
  generating: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const status = useGitAiAgentStatus(agent);
  const state =
    agent === null
      ? { label: 'Generate', disabled: true, busy: false, title: 'Checking Settings › Git › AI…' }
      : describeGenerateButton({
          agent,
          status: status.data ?? null,
          statusError: status.error ? status.error.message : null,
          generating,
        });

  return (
    <button
      type="button"
      data-git-ai-generate=""
      onClick={generating ? onCancel : onGenerate}
      disabled={state.disabled}
      title={state.title}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-md border-none bg-transparent px-1.5 py-1 text-tiny tracking-tiny text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:opacity-70',
        className
      )}
    >
      {state.busy ? (
        <Loader2 className="size-icon-xs animate-spin" />
      ) : (
        <Sparkles className="size-icon-xs" />
      )}
      {state.label}
    </button>
  );
}

/** Why a Generate failed and what the agent printed; the field is untouched. */
export function GitAiFailureNotice({
  failure,
  onDismiss,
}: {
  failure: GitAiFailureView;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      data-git-ai-failure=""
      className="flex flex-col gap-1.5 rounded-md border border-status-err-border bg-surface px-2 py-1.5"
    >
      <div className="flex items-start gap-1.5">
        <p data-git-ai-reason="" className="flex-1 text-tiny tracking-tiny text-status-err">
          {failure.reason}
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="cursor-pointer rounded-sm border-none bg-transparent p-0.5 text-text-passive hover:text-text"
        >
          <X className="size-icon-xs" />
        </button>
      </div>
      {failure.output && (
        <pre
          aria-label="Agent output"
          className="max-h-40 overflow-auto rounded-sm bg-surface-inset px-2 py-1 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-text-muted"
        >
          {failure.output}
        </pre>
      )}
    </div>
  );
}
