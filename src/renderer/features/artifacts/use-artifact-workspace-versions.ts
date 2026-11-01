import type { ArtifactSource } from './artifact-surface';
import { useCloudVersions } from './cloud/use-cloud-versions';
import { useVersions, type ArtifactVersion } from './use-versions';

export interface ArtifactWorkspaceVersions {
  versions: ArtifactVersion[];
  loadError: string | null;
  previewVersion: ArtifactVersion | null;
  previewHtml: string | null;
  previewVersionSnapshot: (version: ArtifactVersion) => void;
  clearPreview: () => void;
  /** Saves the artifact as it reads now; a cloud save snapshots the server's live state. */
  saveVersion: (content: string, label?: string) => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * The version history from the workspace's source: the local database for
 * the author's own copy, the cloud API for everyone else. Both hooks are
 * always called; only the named one fetches.
 */
export function useArtifactWorkspaceVersions(options: {
  source: ArtifactSource;
  workItemId: string;
  artifactId: string;
  enabled: boolean;
  previewAsDocument: boolean;
}): ArtifactWorkspaceVersions {
  const { source, workItemId, artifactId, enabled, previewAsDocument } = options;
  const local = useVersions({
    workItemId,
    artifactId,
    enabled: enabled && source === 'local',
    previewAsDocument,
  });
  const cloud = useCloudVersions({
    workItemId,
    artifactId,
    enabled: enabled && source === 'cloud',
    previewAsDocument,
  });

  if (source === 'local') {
    return {
      versions: local.versions,
      loadError: local.loadError,
      previewVersion: local.previewVersion,
      previewHtml: local.previewHtml,
      previewVersionSnapshot: local.previewVersionSnapshot,
      clearPreview: local.clearPreview,
      saveVersion: (content, label) => local.saveManualVersion(content, label),
      refetch: local.refetch,
    };
  }
  return {
    versions: cloud.versions,
    loadError: cloud.loadError,
    previewVersion: cloud.previewVersion,
    previewHtml: cloud.previewHtml,
    previewVersionSnapshot: cloud.previewVersionSnapshot,
    clearPreview: cloud.clearPreview,
    saveVersion: () => cloud.saveManualVersion(),
    refetch: cloud.refetch,
  };
}
