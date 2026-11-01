import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NeedsYouPullRequests } from '@shared/sidebar-summaries';
import { rpc } from '@renderer/lib/ipc';

/** Same cadence as main's PR sync (`PrSyncScheduler`) and its search cache. */
const NEEDS_YOU_PRS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * PRs waiting on the signed-in GitHub user, any repo. Kept apart from the
 * sidebar summaries so an offline machine loses only the review reasons:
 * a failure is logged and `pullRequests` stays undefined (or at the last
 * success). `failed` lets a surface that lists them say so.
 */
export function useNeedsYouPullRequests(): {
  pullRequests: NeedsYouPullRequests | undefined;
  failed: boolean;
  retry: () => void;
} {
  const { data, error, refetch } = useQuery({
    queryKey: ['sidebar', 'needsYouPullRequests'],
    queryFn: () => rpc.github.getNeedsYouPullRequests(),
    staleTime: NEEDS_YOU_PRS_INTERVAL_MS,
    refetchInterval: NEEDS_YOU_PRS_INTERVAL_MS,
    retry: false,
  });

  useEffect(() => {
    if (!error) return;
    console.error(
      '[sidebar] review requests unavailable:',
      error instanceof Error ? error.message : error
    );
  }, [error]);

  return { pullRequests: data, failed: !!error, retry: () => void refetch() };
}
