import { participantLayoutKey } from './pane-host';

/** An artifact a navigation asked for (a link, a notification), opened as a tab once its work item resolves. */
export interface RequestedArtifact {
  workItemId: string;
  artifactId: string;
  title: string;
}

/**
 * The layout a requested artifact opens in: the owner's own for a local item;
 * the teammate layout for a cloud item, and for one scoped to the artifacts
 * shared with the viewer (step 4, S9), which is the same view.
 */
export function requestedArtifactLayoutKey(resolved: {
  kind: 'local' | 'cloud' | 'artifacts_only';
  id: string;
}): string {
  return resolved.kind === 'local' ? resolved.id : participantLayoutKey(resolved.id);
}
