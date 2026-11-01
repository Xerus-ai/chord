import { useEffect, useState } from 'react';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { planVersionEventRefresh } from './cloud-page-state';

/**
 * Keeps an open cloud tab current on `artifact_version_created` (broadcast to
 * the work-item and artifact rooms): the history is refetched, and a page's
 * frame reloads when the new version has a view. Returns the frame's reload
 * signal, bumped per reload.
 */
export function useCloudVersionEvents(options: {
  artifactId: string;
  renderClass: ArtifactRenderClass | null;
  enabled: boolean;
  onVersionsChanged: () => void;
}): number {
  const { artifactId, renderClass, enabled, onVersionsChanged } = options;
  const { subscribeEvent } = useSyncSocketContext();
  const [reloadSignal, setReloadSignal] = useState(0);

  useEffect(() => {
    if (!enabled || renderClass === null) return;
    return subscribeEvent('artifact_version_created', (payload) => {
      const plan = planVersionEventRefresh(payload, { artifactId, renderClass });
      if (plan.refetchVersions) onVersionsChanged();
      if (plan.reloadFrame) setReloadSignal((n) => n + 1);
    });
  }, [enabled, artifactId, renderClass, subscribeEvent, onVersionsChanged]);

  return reloadSignal;
}
