import { useEffect } from 'react';
import { artifactPathTab } from './center-tab';
import { openCenterTab } from './center-tabs-store';
import { requestedArtifactLayoutKey, type RequestedArtifact } from './requested-artifact-layout';
import type { WorkItemResolution } from './work-item-resolution-state';

/**
 * Opens the artifact a navigation asked for (an artifact link, a notification)
 * as a tab of its work item, once the work item has resolved — whole or
 * scoped to its shared artifacts (`requestedArtifactLayoutKey`). The request is
 * consumed so revisiting the item does not reopen it.
 */
export function useOpenRequestedArtifact(
  resolution: WorkItemResolution,
  requested: RequestedArtifact | undefined,
  consumeRequest: () => void
): void {
  const resolved =
    resolution.kind === 'local' ||
    resolution.kind === 'cloud' ||
    resolution.kind === 'artifacts_only'
      ? { kind: resolution.kind, id: resolution.item.id }
      : null;
  const layoutKey = resolved ? requestedArtifactLayoutKey(resolved) : null;
  const resolvedId = resolved?.id ?? null;

  useEffect(() => {
    if (!requested || !layoutKey || resolvedId !== requested.workItemId) return;
    openCenterTab(layoutKey, artifactPathTab(requested.artifactId, requested.title));
    consumeRequest();
  }, [requested, resolvedId, layoutKey, consumeRequest]);
}
