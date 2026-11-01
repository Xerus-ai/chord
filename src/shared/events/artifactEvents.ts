import type { WorkItemSourceDrift } from '@shared/artifact-source-drift';
import { defineEvent } from '@shared/ipc/events';

export interface ArtifactContentUpdate {
  workItemId: string;
  artifactId: string;
  filePath: string;
  content: string;
}

export const artifactContentUpdateChannel =
  defineEvent<ArtifactContentUpdate>('artifact-content-update');

/**
 * A sandboxed artifact frame tried to navigate itself somewhere the renderer
 * CSP (`frame-src`) refuses. Chromium leaves an error page in the frame; the
 * host that owns the frame (matched by the iframe's `name`) remounts it.
 */
export interface ArtifactFrameNavigationBlocked {
  frameName: string;
  url: string;
}

export const artifactFrameNavigationBlockedChannel = defineEvent<ArtifactFrameNavigationBlocked>(
  'artifact-frame-navigation-blocked'
);

/** A work item's out-of-date artifacts: after a turn, a source file change, a publish or a review. */
export const artifactSourceDriftChannel = defineEvent<WorkItemSourceDrift>('artifact-source-drift');
