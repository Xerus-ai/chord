import type { FeatureFlag, FeatureFlags } from '@chord/protocol';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { featureFlagsChangedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

const KEY = ['app', 'feature-flags'] as const;

/**
 * Keeps the cached flags in step with each change main reports. Registered once for the app's
 * query client (App.tsx), not per reader: the flags are cached for good, so a listener that ran
 * only while a reader was mounted left Settings showing old flags (devstation-mg6u.98).
 */
export function subscribeFeatureFlags(client: QueryClient): () => void {
  return events.on(featureFlagsChangedChannel, (flags: FeatureFlags) => {
    client.setQueryData(KEY, flags);
  });
}

/**
 * The feature flags the sync server turns on (devstation-mg6u.90): read once from main, then
 * replaced by each change main reports (subscribeFeatureFlags).
 */
export function useFeatureFlags() {
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
