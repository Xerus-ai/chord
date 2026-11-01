import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { soloChangedChannel } from '@shared/events/soloEvents';
import type { Result } from '@shared/result';
import type { SoloActionError, SoloView } from '@shared/solo';
import { toastRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';

const soloViewKey = (repoId: string) => ['solo', repoId] as const;

/** Keeps every reader of a repository's Solo slot current: a change carries the whole view. */
export function wireSoloInvalidation(): void {
  events.on(soloChangedChannel, (view) => {
    queryClient.setQueryData<SoloView>(soloViewKey(view.repoId), view);
  });
}

/** A repository's Solo slot; idle without a repository. Kept current by `wireSoloInvalidation`. */
export function useSoloView(repoId: string | null) {
  return useQuery({
    queryKey: soloViewKey(repoId ?? ''),
    queryFn: async () => {
      const result = await rpc.solo.getState(repoId!);
      if (!result.success) throw new Error('Could not read the Solo state');
      return result.data;
    },
    enabled: repoId !== null,
    staleTime: Infinity,
  });
}

/**
 * Solo this branch / Queue / Leave queue / Sync from lane / Release (and
 * Discard and release, and Restore) for one lane: whether one is on its way,
 * and why the last one did not go through.
 */
export function useSoloActions(laneId: string, repoId: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SoloActionError | null>(null);

  const perform = useCallback(async (action: () => Promise<Result<unknown, SoloActionError>>) => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.success) setError(result.error);
    } catch (thrown) {
      toastRpcFailure('Solo', thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setPending(false);
    }
  }, []);

  return {
    pending,
    error,
    solo: () => perform(() => rpc.solo.soloLane(laneId)),
    leaveQueue: () => perform(() => rpc.solo.leaveQueue(laneId)),
    sync: () => perform(() => rpc.solo.sync(laneId)),
    release: (discardRootChanges: boolean) =>
      perform(() => rpc.solo.release({ repoId, discardRootChanges })),
  };
}
