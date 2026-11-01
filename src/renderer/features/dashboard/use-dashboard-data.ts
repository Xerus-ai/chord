import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { DashboardLinksById } from '@shared/dashboard-links';
import { cloudApi } from '@renderer/lib/cloud-api';
import type { AvatarStackMember } from '@renderer/lib/components/chrome/avatar-stack';
import { describeLoadError } from '@renderer/lib/components/load-error-notice';
import { useAuthState } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';

/** Tickets and artifacts change on a user action, not on a turn — no need to
 * poll at the summaries' 10s cadence. */
const LINKS_STALE_MS = 30_000;

/**
 * Tickets and artifacts for the given cards, as one read. Its own query so
 * a failure costs the cards only these two facts: the error is returned for
 * the one notice the view shows, and `links` stays undefined (or at the last
 * success) rather than turning into empty lists that would claim "none".
 */
export function useDashboardLinks(workItemIds: string[]) {
  const stableKey = workItemIds.join(',');
  const { data, error, refetch } = useQuery({
    queryKey: ['dashboard', 'links', stableKey],
    queryFn: async (): Promise<DashboardLinksById> => {
      const ids = stableKey.split(',');
      const result = await rpc.workItems.getDashboardLinks(ids);
      if (!result.success) throw new Error('workItems.getDashboardLinks failed');
      return result.data.links;
    },
    enabled: stableKey !== '',
    staleTime: LINKS_STALE_MS,
  });
  return {
    links: data,
    error: error ? describeLoadError(error) : null,
    retry: () => void refetch(),
  };
}

/**
 * Who each of the user's own items is shared with, keyed by work item id.
 * Signed-out users have no cloud rosters, so the query does not run and every
 * card simply shows no avatars. A failed read is logged, not surfaced: the
 * avatars are decoration on a card whose actions all still work without them.
 */
export function useParticipantRosters(): Map<string, AvatarStackMember[]> {
  const authState = useAuthState();
  const { data, error } = useQuery({
    queryKey: ['dashboard', 'participantRosters'],
    queryFn: () => cloudApi.getParticipantRosters(),
    enabled: authState === 'signed_in',
    staleTime: LINKS_STALE_MS,
  });

  useEffect(() => {
    if (error)
      console.error('[dashboard] participant rosters unavailable:', describeLoadError(error));
  }, [error]);

  return useMemo(() => {
    const byItem = new Map<string, AvatarStackMember[]>();
    for (const row of data ?? []) {
      byItem.set(row.work_item_id, [
        ...(byItem.get(row.work_item_id) ?? []),
        { user_id: row.user_id, name: row.name, email: row.email },
      ]);
    }
    return byItem;
  }, [data]);
}
