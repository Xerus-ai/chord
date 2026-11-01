import { useEffect } from 'react';
import {
  registerPublishableArtifact,
  unregisterPublishableArtifact,
  type PublishableArtifact,
} from './publishable-artifacts';

/**
 * An open artifact tab the owner may publish: what the Publish tab sends for
 * it, kept current while the tab is open and dropped when it closes.
 */
export function useRegisterPublishable(
  artifactId: string,
  entry: PublishableArtifact,
  enabled: boolean
): void {
  const { artifactType, content, onPublished } = entry;
  useEffect(() => {
    if (!enabled) return;
    registerPublishableArtifact(artifactId, { artifactType, content, onPublished });
    return () => unregisterPublishableArtifact(artifactId);
  }, [artifactId, artifactType, content, onPublished, enabled]);
}
