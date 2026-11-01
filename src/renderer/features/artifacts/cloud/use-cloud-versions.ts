import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { artifactCloudApi } from '@renderer/features/artifacts/cloud/artifact-cloud-api';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { toast } from '@renderer/lib/hooks/use-toast';
import type { ArtifactVersion } from '../use-versions';
import { toArtifactVersionFromCloud } from './cloud-artifact';

export function cloudArtifactVersionsKey(artifactId: string) {
  return ['cloudArtifact', 'versions', artifactId] as const;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UseCloudVersionsOptions {
  workItemId: string;
  artifactId: string;
  enabled: boolean;
  /** Documents preview a server snapshot; a page previews in its own cloud frame. */
  previewAsDocument: boolean;
}

/**
 * The version history of an artifact read from the cloud, in the same shape
 * as the local `useVersions`. A document's manual save snapshots the server's
 * live Yjs state; pages are never saved here (only the author's app can build
 * the view a page version needs).
 */
export function useCloudVersions({
  workItemId,
  artifactId,
  enabled,
  previewAsDocument,
}: UseCloudVersionsOptions) {
  const queryClient = useQueryClient();
  const versionsQuery = useQuery({
    queryKey: cloudArtifactVersionsKey(artifactId),
    queryFn: async () =>
      (await artifactCloudApi.getVersions(workItemId, artifactId)).map(toArtifactVersionFromCloud),
    enabled,
  });
  const versions = versionsQuery.data ?? NO_VERSIONS;

  const [previewVersion, setPreviewVersion] = useState<ArtifactVersion | null>(null);
  const clearPreview = useCallback(() => setPreviewVersion(null), []);
  const snapshotQuery = useQuery({
    queryKey: ['cloudArtifact', 'snapshot', artifactId, previewVersion?.id ?? null],
    queryFn: async () => {
      if (!previewVersion) throw new Error('[versions] no version selected for preview');
      return (await artifactCloudApi.getVersionSnapshot(workItemId, artifactId, previewVersion.id))
        .html;
    },
    enabled: enabled && previewAsDocument && previewVersion !== null,
    staleTime: Infinity,
  });

  const loadError = versionsQuery.error
    ? `Version history could not be loaded: ${describe(versionsQuery.error)}`
    : snapshotQuery.error
      ? `Version preview could not be loaded: ${describe(snapshotQuery.error)}`
      : null;

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: cloudArtifactVersionsKey(artifactId) }),
    [queryClient, artifactId]
  );

  const saveManualVersion = useCallback(async () => {
    try {
      await artifactCloudApi.saveVersion(workItemId, artifactId, {
        trigger: 'manual',
        baseVersion: versions[0]?.version_number ?? 0,
      });
    } catch (e) {
      if (e instanceof CloudApiError && e.status === 409) {
        toast({
          title: 'Version not saved',
          description:
            'Someone saved a version since this history loaded. Review it and save again.',
        });
      } else {
        const description = `Saving version failed: ${describe(e)}`;
        console.error(`[versions] ${description}`);
        toast({ title: 'Saving version', description, variant: 'destructive' });
      }
    }
    await refetch();
  }, [workItemId, artifactId, versions, refetch]);

  return {
    versions,
    loadError,
    previewVersion,
    previewHtml: previewAsDocument ? (snapshotQuery.data ?? null) : null,
    previewVersionSnapshot: setPreviewVersion,
    clearPreview,
    saveManualVersion,
    refetch,
  };
}

const NO_VERSIONS: ArtifactVersion[] = [];
