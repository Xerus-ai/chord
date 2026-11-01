import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import type { OpenTargetNavigation } from '@renderer/features/deep-links/deep-link-navigation';

/**
 * Where an item reached only through artifacts shared alone opens (step 4,
 * S9): the work item, scoped to those artifacts, with the artifact asked for
 * (or the first one shared) as a tab. Every entry point asks here.
 */
export function openArtifactsOnlyTarget(
  item: Pick<ArtifactsOnlyWorkItem, 'id' | 'shared_artifacts'>,
  artifactId: string | null
): OpenTargetNavigation {
  const artifact =
    artifactId === null
      ? item.shared_artifacts[0]
      : item.shared_artifacts.find((shared) => shared.id === artifactId);
  if (!artifact) {
    throw new Error(`Work item ${item.id} does not share artifact ${artifactId}`);
  }
  return {
    view: 'work-list',
    params: {
      workItemId: item.id,
      openArtifact: { workItemId: item.id, artifactId: artifact.id, title: artifact.name },
    },
  };
}
