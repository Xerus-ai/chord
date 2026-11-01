import { create } from 'zustand';
import type { ArtifactType } from '@shared/stream-items';

export interface PublishableArtifact {
  artifactType: ArtifactType | null;
  /**
   * What a publish sends: a document's live content once its editor holds it
   * (null before then), or a page's source; main reads other files itself.
   */
  content: string | null;
  /** A publish saved a version: the open tab re-reads its versions. */
  onPublished: () => void;
}

/**
 * The owner's open artifact tabs, as the Share dialog's Publish tab needs
 * them: a document is published from what its editor holds, which only the
 * tab has. Client-only, and gone with the tab.
 */
export const usePublishableArtifacts = create<{ open: Record<string, PublishableArtifact> }>()(
  () => ({ open: {} })
);

export function registerPublishableArtifact(artifactId: string, entry: PublishableArtifact): void {
  usePublishableArtifacts.setState((state) => ({ open: { ...state.open, [artifactId]: entry } }));
}

export function unregisterPublishableArtifact(artifactId: string): void {
  usePublishableArtifacts.setState((state) => {
    const { [artifactId]: _closed, ...rest } = state.open;
    return { open: rest };
  });
}
