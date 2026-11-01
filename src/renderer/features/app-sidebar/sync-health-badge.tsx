import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, Loader2 } from 'lucide-react';
import { useAuthState } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';

const FAILED_OPS_KEY = ['syncQueue', 'failedOperations'] as const;
const QUEUE_HEALTH_KEY = ['syncQueue', 'health'] as const;

// A pending backlog is only surfaced once the drain has made no progress for
// this long (or has never run) — ordinary retry backoff must not flash a
// banner, but a wedged queue (NEW-6 sat silent for 20 days) must show.
const STALE_DRAIN_SECONDS = 15 * 60;

/**
 * Sync surfacing: permanently-failed operations (count + one "Retry all"
 * action) and a stale-backlog banner when pending operations aren't
 * draining. Hidden while the queue is healthy; error detail stays in the
 * main-process logs.
 */
export function SyncHealthBadge() {
  const queryClient = useQueryClient();
  const authState = useAuthState();
  const { data } = useQuery({
    queryKey: FAILED_OPS_KEY,
    queryFn: async () => {
      const result = await rpc.syncQueue.getFailedOperations();
      if (!result.success) throw new Error('getFailedOperations failed');
      return result.data.operations;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: health } = useQuery({
    queryKey: QUEUE_HEALTH_KEY,
    queryFn: async () => {
      const result = await rpc.syncQueue.getQueueHealth();
      if (!result.success) throw new Error('getQueueHealth failed');
      // Staleness is judged against fetch time, not render time — renders
      // must stay pure, and the 30s refetch keeps this fresh enough.
      return { ...result.data, fetchedAtSeconds: Math.floor(Date.now() / 1000) };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const retryAll = useMutation({
    mutationFn: async () => {
      const result = await rpc.syncQueue.retryAll();
      if (!result.success) throw new Error('retryAll failed');
      return result.data.retried;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FAILED_OPS_KEY });
    },
  });

  const failedCount = data?.length ?? 0;

  const drainIsStale =
    health !== undefined &&
    health.pendingCount > 0 &&
    (health.lastSuccessfulDrainAt === null ||
      health.fetchedAtSeconds - health.lastSuccessfulDrainAt >= STALE_DRAIN_SECONDS);

  // An expired session is WHY operations are queued — ReauthBadge names the
  // cause and the fix, so repeating the symptom here would say it twice.
  if (authState === 'reauth_required') return null;

  if (failedCount === 0 && !drainIsStale) return null;

  const queuedSince =
    health?.oldestPendingAt != null
      ? new Date(health.oldestPendingAt * 1000).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
      : null;

  const operations = (count: number) => `${count} sync ${count === 1 ? 'operation' : 'operations'}`;

  // Chips, in the same geometry as ReauthBadge: both sit in the footer row, and
  // the two used to render as a pill and a bordered callout in the one slot.
  // The full sentence moves to the tooltip.
  return (
    <div className="flex shrink-0 items-center gap-1">
      {failedCount > 0 && (
        <button
          type="button"
          onClick={() => retryAll.mutate()}
          disabled={retryAll.isPending}
          title={`${operations(failedCount)} failed. Click to retry all.`}
          className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-md bg-status-err/15 px-2 text-tiny tracking-tiny font-medium text-status-err transition-colors hover:bg-status-err/25 disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          {retryAll.isPending ? (
            <Loader2 className="size-icon-xs animate-spin" />
          ) : (
            <CloudOff className="size-icon-xs" strokeWidth={2.25} />
          )}
          {failedCount} failed · Retry
        </button>
      )}
      {drainIsStale && health && (
        <span
          title={
            health.orgUnresolved
              ? `${operations(health.pendingCount)} queued. Sync is blocked: no workspace could be resolved for this account.`
              : `${operations(health.pendingCount)} queued${queuedSince ? ` since ${queuedSince}` : ''}. Sync has not made progress recently.`
          }
          className="flex h-[22px] shrink-0 items-center gap-1 rounded-md bg-status-warn/15 px-2 text-tiny tracking-tiny font-medium text-status-warn"
        >
          <CloudOff className="size-icon-xs" strokeWidth={2.25} />
          {health.pendingCount} queued
        </span>
      )}
    </div>
  );
}
