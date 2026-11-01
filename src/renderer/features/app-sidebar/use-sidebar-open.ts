import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { useCallback, useMemo } from 'react';
import { useOpenTarget } from '@renderer/features/deep-links/use-open-target';
import { openArtifactsOnlyTarget } from '@renderer/features/shared-items/open-artifacts-only';

/**
 * Opening a sidebar row. A work item opens in the work list; an item reached
 * only through artifacts shared alone opens its artifact through
 * `openArtifactsOnlyTarget` (decision 4), the one place step 4 changes. A
 * click on a row that stands for several artifacts expands it to one child
 * row each; the keyboard (Mod+N, cycling) opens the first.
 */
export function useSidebarOpen({
  artifactsOnlyItems,
  toggleExpanded,
}: {
  artifactsOnlyItems: readonly ArtifactsOnlyWorkItem[];
  toggleExpanded: (workItemId: string) => void;
}) {
  const openTarget = useOpenTarget();
  const artifactsOnlyById = useMemo(
    () => new Map(artifactsOnlyItems.map((item) => [item.id, item])),
    [artifactsOnlyItems]
  );

  const openWorkItem = useCallback(
    (workItemId: string) => {
      const artifactsOnly = artifactsOnlyById.get(workItemId);
      openTarget(
        artifactsOnly
          ? openArtifactsOnlyTarget(artifactsOnly, null)
          : { view: 'work-list', params: { workItemId } }
      );
    },
    [artifactsOnlyById, openTarget]
  );

  const openRow = useCallback(
    (workItemId: string) => {
      const artifactsOnly = artifactsOnlyById.get(workItemId);
      if (artifactsOnly && artifactsOnly.shared_artifacts.length > 1) toggleExpanded(workItemId);
      else openWorkItem(workItemId);
    },
    [artifactsOnlyById, openWorkItem, toggleExpanded]
  );

  const openArtifact = useCallback(
    (workItemId: string, artifactId: string) => {
      const artifactsOnly = artifactsOnlyById.get(workItemId);
      if (!artifactsOnly) {
        throw new Error(`${workItemId} is not an item reached only through its artifacts`);
      }
      openTarget(openArtifactsOnlyTarget(artifactsOnly, artifactId));
    },
    [artifactsOnlyById, openTarget]
  );

  return { openWorkItem, openRow, openArtifact };
}
