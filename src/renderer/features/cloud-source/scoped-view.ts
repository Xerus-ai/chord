import type { ArtifactsOnlyWorkItem } from '@chord/protocol';

type ScopedItem = Pick<
  ArtifactsOnlyWorkItem,
  'creator_name' | 'creator_email' | 'shared_artifacts'
>;

/**
 * The rooms an artifacts-only viewer holds (step 4, decision 6): one
 * `artifact:` room per shared artifact, where its comments and versions
 * arrive. Never the work item's room: the server refuses it.
 */
export function scopedViewArtifactIds(item: Pick<ScopedItem, 'shared_artifacts'>): string[] {
  return item.shared_artifacts.map((artifact) => artifact.id);
}

/** What the scoped view's Work item panel says of what the viewer can see. */
export function scopedViewNotice(item: ScopedItem): string {
  const count = item.shared_artifacts.length;
  const owner = item.creator_name ?? item.creator_email;
  return `You can see ${count} artifact${count === 1 ? '' : 's'} in this work item. Shared by ${owner}.`;
}
