import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import type { CloudWorkItem, SharedWithMeRow } from '@renderer/lib/cloud-api';

export interface SharedRows {
  workItems: CloudWorkItem[];
  artifactsOnly: ArtifactsOnlyWorkItem[];
  /** Rooms the sidebar holds for live updates of the shared work items. */
  workItemRoomIds: string[];
  /**
   * An item reached only through its artifacts would be refused its work
   * item's room; the artifacts' own rooms carry what it may see.
   */
  artifactRoomIds: string[];
}

/** The shared-with-me listing's two kinds of row, and the rooms each holds. */
export function splitSharedRows(rows: SharedWithMeRow[]): SharedRows {
  const workItems: CloudWorkItem[] = [];
  const artifactsOnly: ArtifactsOnlyWorkItem[] = [];
  for (const row of rows) {
    if (row.access_scope === 'artifacts') artifactsOnly.push(row);
    else workItems.push(row);
  }
  return {
    workItems,
    artifactsOnly,
    workItemRoomIds: workItems.map((item) => item.id),
    artifactRoomIds: artifactsOnly.flatMap((item) => item.shared_artifacts.map((a) => a.id)),
  };
}
