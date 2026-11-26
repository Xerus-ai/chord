import type { FeatureFlag, FeatureFlags } from '@chord/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { featureFlagsChangedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

const KEY = ['app', 'feature-flags'] as const;

/**
 * The feature flags the sync server turns on (devstation-mg6u.90): read once from main, then
 * replaced by each change main reports.
 */
export function useFeatureFlags() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      events.on(featureFlagsChangedChannel, (flags: FeatureFlags) => {
        queryClient.setQueryData(KEY, flags);
      }),
    [queryClient]
  );
  return useQuery({
    queryKey: KEY,
    queryFn: (): Promise<FeatureFlags> => rpc.app.getFeatureFlags(),
    staleTime: Infinity,
  });
}

/** Whether `flag` is on; off until main answers, so unfinished work never flashes in. */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useFeatureFlags().data?.[flag] === true;
}
