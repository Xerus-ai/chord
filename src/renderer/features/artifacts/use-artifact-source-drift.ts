import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ArtifactSourceDrift, WorkItemSourceDrift } from '@shared/artifact-source-drift';
import { artifactSourceDriftChannel } from '@shared/events/artifactEvents';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { events, rpc } from '@renderer/lib/ipc';

/**
 * Out-of-date artifacts (plan 2026-09-23 §4 P4 step 2). Main owns drift — it
 * hashes the sources and watches them — and pushes the work item's whole list
 * on `artifactSourceDriftChannel`; the renderer keeps it in the query cache.
 */

function driftQueryKey(workItemId: string) {
  return ['artifacts', 'sourceDrift', workItemId] as const;
}

/**
 * Keeps the work item's drift current while mounted. Main counts watchers, so
 * every surface that shows artifacts (the transcript, an open artifact) holds
 * its own watch and releases it on unmount.
 */
export function useWatchArtifactSourceDrift(workItemId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workItemId) return;
    const queryKey = driftQueryKey(workItemId);
    const off = events.on(artifactSourceDriftChannel, (update: WorkItemSourceDrift) => {
      if (update.workItemId === workItemId) queryClient.setQueryData(queryKey, update.drift);
    });
    void rpc.artifacts.watchSourceDrift({ workItemId }).then((result) => {
      queryClient.setQueryData(queryKey, result.data.drift);
    });
    return () => {
      off();
      void rpc.artifacts.unwatchSourceDrift({ workItemId });
    };
  }, [workItemId, queryClient]);
}

/** One artifact's drift, or null while it is up to date (or no view watches its work item). */
export function useArtifactSourceDrift(
  workItemId: string,
  artifactId: string
): ArtifactSourceDrift | null {
  const { data } = useQuery<ArtifactSourceDrift[]>({
    queryKey: driftQueryKey(workItemId),
    // Filled by useWatchArtifactSourceDrift; never fetched on its own.
    queryFn: skipToken,
  });
  return data?.find((drift) => drift.artifactId === artifactId) ?? null;
}

function describeRpcError(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

function describeUpdateRequest(drift: ArtifactSourceDrift): string {
  const changed = drift.changed.map(
    (source) => `- ${source.path}${source.change === 'deleted' ? ' (deleted)' : ''}`
  );
  return [
    `The artifact \`${drift.filePath}\` was published from source files that have changed since:`,
    ...changed,
    'Update the artifact where these changes affect what it says, then publish it again with publish_artifact. If nothing in it is affected, say so.',
  ].join('\n');
}

/** Update (asks the agent to bring the artifact up to date) and Mark reviewed. */
export function useArtifactDriftActions(workItemId: string) {
  const { data: session } = useAccountSession();
  const senderName = session?.user?.username || session?.user?.email || null;

  const requestUpdate = useMutation({
    mutationFn: async (drift: ArtifactSourceDrift) => {
      if (!senderName) throw new Error('Sign in to Chord to ask the agent.');
      const result = await rpc.chatMessages.sendToAgent({
        workItemId,
        content: describeUpdateRequest(drift),
        senderName,
      });
      if (!result.success) throw new Error(describeRpcError(result.error));
    },
  });

  const markReviewed = useMutation({
    mutationFn: async (artifactId: string) => {
      const result = await rpc.artifacts.markSourcesReviewed({ artifactId });
      if (!result.success) throw new Error(`Could not mark reviewed: ${result.error.type}`);
    },
  });

  return { requestUpdate, markReviewed };
}
