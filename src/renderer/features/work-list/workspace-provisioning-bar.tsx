import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, CircleSlash, Loader2, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { parseProvisionError } from '@shared/work-item-provision-error';
import type { Worktree } from '@shared/worktrees';
import { FoldedOutput } from '@renderer/lib/components/folded-output';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import { describeSkippedSetup } from './lane-setup-bar-model';
import { SetupLog } from './setup-log';

function RetryButton({
  onClick,
  busy,
  label = 'Retry',
}: {
  onClick: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-xs bg-surface-hover-solid px-2 py-0.5 text-tiny tracking-tiny font-semibold text-text transition-colors hover:bg-surface-active-solid disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </button>
  );
}

/**
 * Where a work item's lane is on its way to running: the checkout being
 * created (or failing to be), then `.chord.json` setup running (or failing).
 * An agent's first turn waits for both, so this strip says why nothing has
 * answered yet — and a failure shows its log next to Retry.
 */
export function WorkspaceProvisioningBar({
  workItemId,
  provisionStatus,
  provisionError,
  lane,
}: {
  workItemId: string;
  provisionStatus: string;
  /** `work_items.provision_error`: a stored `ProvisionError` (shared/work-item-provision-error.ts). */
  provisionError: string | null;
  lane: Worktree | undefined;
}) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const fail = useCallback((what: string, description: string) => {
    toast({ title: `${what} failed`, description, variant: 'destructive' });
  }, []);

  const retryProvision = useCallback(
    (options: { allowLocalCopy: boolean }) => {
      setRetrying(true);
      rpc.workItems
        .retryProvision(workItemId, options)
        .then((result) => {
          if (!result.success) {
            fail('Retry', `Could not retry creating the checkout (${result.error.type}).`);
          }
        })
        .catch((e: unknown) =>
          fail('Retry', describeThrownFailure('Retry creating the checkout', e))
        )
        .finally(() => setRetrying(false));
    },
    [workItemId, fail]
  );

  const retrySetup = useCallback(async () => {
    if (!lane) return;
    setRetrying(true);
    try {
      // Setup itself asks for approval of an unapproved .chord.json.
      const result = await rpc.worktrees.retrySetup(lane.id);
      if (!result.success) fail('Retry', describeRpcFailure('Retry setup', result.error));
    } catch (e) {
      fail('Retry', describeThrownFailure('Retry setup', e));
    } finally {
      setRetrying(false);
      void queryClient.invalidateQueries({ queryKey: ['worktrees', 'list', workItemId] });
    }
  }, [lane, workItemId, fail, queryClient]);

  if (provisionStatus === 'provisioning') {
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-passive" />
        <span className="text-body tracking-body text-text-passive">
          Creating the branch and its checkout…
        </span>
      </div>
    );
  }

  if (provisionStatus === 'failed') {
    const error = provisionError === null ? null : parseProvisionError(provisionError);
    return (
      <div className="mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-status-warn" />
          <span className="text-body tracking-body text-text">
            Could not create this work item's checkout
          </span>
          <RetryButton onClick={() => retryProvision({ allowLocalCopy: false })} busy={retrying} />
        </div>
        {error && <p className="text-tiny tracking-tiny text-text-muted">{error.message}</p>}
        {error?.type === 'base_fetch_failed' && error.gitOutput && (
          <FoldedOutput label="Show git output" output={error.gitOutput} />
        )}
        {error?.type === 'base_fetch_failed' && (
          // Forking from a copy that may be behind the remote is the user's
          // call, made here with the SHA in view — never done for them.
          <button
            onClick={() => retryProvision({ allowLocalCopy: true })}
            disabled={retrying}
            className="self-start cursor-pointer rounded-xs bg-surface-hover-solid px-2 py-0.5 text-tiny tracking-tiny font-semibold text-text transition-colors hover:bg-surface-active-solid disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
          >
            Create from local copy of {error.ref} ({error.lastFetchedSha.slice(0, 7)})
          </button>
        )}
      </div>
    );
  }

  const setupStatus = lane?.setupStatus;
  if (!lane || setupStatus === null || setupStatus === 'ok' || setupStatus === undefined) {
    return null;
  }

  if (setupStatus === 'skipped') {
    // The user chose Don't run for this lane's scripts, or adopted a checkout
    // whose setup Chord never runs on its own. Agents start without it; Run
    // setup runs it (asking about scripts it has not been allowed to run).
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <CircleSlash className="h-3.5 w-3.5 shrink-0 text-text-passive" />
        <span className="text-body tracking-body text-text">{describeSkippedSetup(lane)}</span>
        <RetryButton label="Run setup" onClick={() => void retrySetup()} busy={retrying} />
      </div>
    );
  }

  const failed = setupStatus === 'failed';
  return (
    <div className="mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-2">
        {failed ? (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-status-warn" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-passive" />
        )}
        <span className={cn('text-body tracking-body', failed ? 'text-text' : 'text-text-passive')}>
          {failed
            ? 'Setup failed — agents wait until it succeeds'
            : 'Running setup — agents start when it finishes'}
        </span>
        {!failed && (
          <button
            onClick={() => setLogOpen((open) => !open)}
            className="ml-auto flex items-center gap-1 text-tiny tracking-tiny text-text-muted hover:text-text"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', !logOpen && '-rotate-90')} />
            Log
          </button>
        )}
        {failed && <RetryButton onClick={() => void retrySetup()} busy={retrying} />}
      </div>
      {(failed || logOpen) && <SetupLog worktreeId={lane.id} status={setupStatus} />}
    </div>
  );
}
