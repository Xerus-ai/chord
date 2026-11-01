import { useCallback, useState } from 'react';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import {
  resolveArtifactSurface,
  type ArtifactAccessRole,
  type ArtifactSource,
  type ArtifactSurface,
} from './artifact-surface';
import { useCloudArtifactDetail } from './cloud/use-cloud-artifact';
import { useArtifactContent } from './use-artifact-content';

export interface ArtifactWorkspaceSource {
  /** Local: the file's seed or page source. Cloud: what the editor reports. */
  content: string;
  setContent: (html: string) => void;
  loading: boolean;
  error: string | null;
  retry: () => void;
  renderClass: ArtifactRenderClass | null;
  artifactType: ArtifactType | null;
  /** The caller's role on the artifact; the author for a local artifact. */
  callerRole: ArtifactAccessRole | null;
  /** Whether the caller reaches the work item too (presence, agent chat). */
  hasWorkItemAccess: boolean;
  /** Null until the artifact's format is known. */
  surface: ArtifactSurface | null;
  /** The artifact exists in the cloud, so its document room is on the collab server. */
  hasCloudCopy: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The artifact behind a workspace, from the source its host named: the local
 * database and file for the author's own copy, `GET /artifacts/:id` for
 * everyone else. Both hooks are always called; only the named one runs.
 */
export function useArtifactWorkspaceSource(
  source: ArtifactSource,
  artifactId: string,
  workItemId: string
): ArtifactWorkspaceSource {
  const local = useArtifactContent(artifactId, workItemId, source === 'local');
  const cloud = useCloudArtifactDetail(artifactId, source === 'cloud');
  // A cloud document's content lives in its Yjs room; this mirrors what the
  // editor reports so versions and publishing read the live document.
  const [cloudContent, setCloudContent] = useState('');
  const { refetch: refetchCloud } = cloud;
  const retryCloud = useCallback(() => void refetchCloud(), [refetchCloud]);

  if (source === 'local') {
    const surface =
      local.renderClass && local.artifactType
        ? resolveArtifactSurface({
            source: 'local',
            renderClass: local.renderClass,
            artifactType: local.artifactType,
          })
        : null;
    return { ...local, callerRole: 'author', hasWorkItemAccess: true, surface };
  }

  const detail = cloud.data ?? null;
  return {
    content: cloudContent,
    setContent: setCloudContent,
    loading: cloud.isPending && !cloud.error,
    error: cloud.error ? `Could not open this artifact — ${describe(cloud.error)}.` : null,
    retry: retryCloud,
    renderClass: detail?.render_class ?? null,
    artifactType: detail?.content_type ?? null,
    callerRole: detail?.caller_role ?? null,
    hasWorkItemAccess: detail !== null && detail.work_item_role !== null,
    // Read from `GET /artifacts/:id`: the cloud has it by definition.
    hasCloudCopy: true,
    surface: detail
      ? resolveArtifactSurface({
          source: 'cloud',
          renderClass: detail.render_class,
          artifactType: detail.content_type,
          callerRole: detail.caller_role,
        })
      : null,
  };
}
