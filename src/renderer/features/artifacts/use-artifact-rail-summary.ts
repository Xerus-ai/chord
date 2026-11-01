import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { useWorkItemRoom } from '@renderer/lib/sync/use-work-item-room';
import {
  mergeArtifactRailSummaries,
  type ArtifactRailCounts,
  type CloudArtifactSummaryRow,
} from './artifact-rail-summary';
import { artifactCloudApi } from './cloud/artifact-cloud-api';
import { useWorkItemArtifacts } from './use-work-item-artifacts';

function railSummaryKey(workItemId: string) {
  return ['artifacts', 'rail-summary', workItemId] as const;
}

/** Refetches a work item's rail counts, e.g. after a comment is added, resolved or read. */
export function invalidateArtifactRailSummary(queryClient: QueryClient, workItemId: string) {
  return queryClient.invalidateQueries({ queryKey: railSummaryKey(workItemId) });
}

/**
 * The rail's `💬 N•  vN` for every artifact of a work item (shared-items step
 * 1, S8): the device's counts merged with the cloud's summary for artifacts
 * that synced (artifact-rail-summary.ts). A teammate's comment arrives as a
 * comment_created ping on the work item's room and refetches the cloud half.
 */
export function useArtifactRailSummary(workItemId: string) {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();
  const { data: session } = useAccountSession();
  const signedIn = session?.isSignedIn === true;
  const artifactsQuery = useWorkItemArtifacts(workItemId);
  const artifacts = useMemo(() => artifactsQuery.data ?? [], [artifactsQuery.data]);
  const needsCloud = signedIn && artifacts.some((artifact) => artifact.cloudId);

  const localQuery = useQuery({
    queryKey: [...railSummaryKey(workItemId), 'local'],
    queryFn: async () => (await rpc.artifacts.listRailSummary(workItemId)).data.artifacts,
    refetchInterval: 10000,
  });
  const cloudQuery = useQuery({
    queryKey: [...railSummaryKey(workItemId), 'cloud'],
    queryFn: () => artifactCloudApi.getArtifactSummary(workItemId),
    enabled: needsCloud,
    refetchInterval: 30000,
  });

  useWorkItemRoom(needsCloud ? workItemId : undefined);
  useEffect(() => {
    if (!needsCloud) return;
    const refetch = () => void invalidateArtifactRailSummary(queryClient, workItemId);
    const stopComments = subscribeEvent('comment_created', refetch, workItemId);
    // Pings broadcast while this window was disconnected.
    const stopReconnect = subscribeEvent('$sync/connected', refetch);
    return () => {
      stopComments();
      stopReconnect();
    };
  }, [needsCloud, subscribeEvent, queryClient, workItemId]);

  const counts = useMemo<Map<string, ArtifactRailCounts>>(
    () =>
      localQuery.data
        ? mergeArtifactRailSummaries({
            artifacts,
            local: localQuery.data,
            cloud: needsCloud ? cloudQuery.data : undefined,
            signedIn,
          })
        : new Map(),
    [artifacts, localQuery.data, cloudQuery.data, needsCloud, signedIn]
  );

  return { counts, error: localQuery.error ?? cloudQuery.error };
}

/**
 * A teammate's per-artifact counts, from the cloud alone: they have no local
 * copy to merge. Same key as the owner's cloud half, so a comment ping or
 * `invalidateArtifactRailSummary` refreshes both.
 */
export function useCloudArtifactRailSummary(
  workItemId: string,
  enabled: boolean
): ReadonlyMap<string, CloudArtifactSummaryRow> {
  const queryClient = useQueryClient();
  const { subscribeEvent } = useSyncSocketContext();
  const query = useQuery({
    queryKey: [...railSummaryKey(workItemId), 'cloud'],
    queryFn: () => artifactCloudApi.getArtifactSummary(workItemId),
    enabled,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!enabled) return;
    const refetch = () => void invalidateArtifactRailSummary(queryClient, workItemId);
    const stopComments = subscribeEvent('comment_created', refetch, workItemId);
    const stopReconnect = subscribeEvent('$sync/connected', refetch);
    return () => {
      stopComments();
      stopReconnect();
    };
  }, [enabled, subscribeEvent, queryClient, workItemId]);

  return useMemo(
    () => new Map((query.data ?? []).map((row) => [row.artifact_id, row])),
    [query.data]
  );
}
