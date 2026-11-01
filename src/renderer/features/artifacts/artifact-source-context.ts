import { createContext, useContext } from 'react';
import type { ArtifactSource } from './artifact-surface';

/**
 * The source of the artifact whose document is on screen, for node views deep
 * inside the editor that behave differently off the author's device.
 */
export const ArtifactSourceContext = createContext<ArtifactSource | null>(null);

export function useArtifactSource(): ArtifactSource {
  const source = useContext(ArtifactSourceContext);
  if (!source) throw new Error('useArtifactSource must be used inside an ArtifactSourceContext');
  return source;
}
