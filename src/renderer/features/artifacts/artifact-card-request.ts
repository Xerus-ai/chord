import { create } from 'zustand';
import type { FileBarCard } from '@renderer/features/work-list/file-bar';

export interface ArtifactCardRequest {
  card: FileBarCard;
  /** A notification about a comment names it, so the card opens on its thread. */
  commentId: string | null;
}

/**
 * "Open this artifact with its comments (or versions) card open" (S8). The
 * rail's 💬 and vN ask, and so does a notification click; the artifact's tab
 * takes the request once, whether it was just opened or was already open.
 * Client-only and never persisted: a request outlives nothing.
 */
export const useArtifactCardRequests = create<{ requests: Record<string, ArtifactCardRequest> }>()(
  () => ({ requests: {} })
);

export function requestArtifactCard(
  artifactId: string,
  card: FileBarCard,
  commentId: string | null = null
): void {
  useArtifactCardRequests.setState((state) => ({
    requests: { ...state.requests, [artifactId]: { card, commentId } },
  }));
}

/** The pending request for this artifact, removed as it is returned. */
export function takeArtifactCardRequest(artifactId: string): ArtifactCardRequest | null {
  const request = useArtifactCardRequests.getState().requests[artifactId];
  if (!request) return null;
  useArtifactCardRequests.setState((state) => {
    const { [artifactId]: _taken, ...rest } = state.requests;
    return { requests: rest };
  });
  return request;
}
