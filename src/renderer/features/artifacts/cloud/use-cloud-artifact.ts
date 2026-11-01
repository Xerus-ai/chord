import { useQuery } from '@tanstack/react-query';
import { artifactCloudApi } from './artifact-cloud-api';

export function cloudArtifactDetailKey(artifactId: string) {
  return ['cloudArtifact', 'detail', artifactId] as const;
}

/**
 * `GET /artifacts/:id` — the metadata and the caller's role for an artifact
 * read from the cloud. Access is re-checked by the server on every read, so a
 * revoked member gets the 404 as an error, never a stale role.
 */
export function useCloudArtifactDetail(artifactId: string, enabled: boolean) {
  return useQuery({
    queryKey: cloudArtifactDetailKey(artifactId),
    queryFn: () => artifactCloudApi.getArtifactDetail(artifactId),
    enabled: enabled && !!artifactId,
    staleTime: 15_000,
  });
}
