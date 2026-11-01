import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { FileText } from 'lucide-react';
import { scopedViewNotice } from '@renderer/features/cloud-source/scoped-view';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { ListRow } from '@renderer/lib/components/list-row';
import { useRailScope } from '../rail-context';
import { PanelShell, RailSection } from '../rail-primitives';

/**
 * The Work item panel of an item reached only through artifacts shared
 * alone: what the viewer can see of it, and who shared it. The rest of the
 * work item (chats, changes, people) is not theirs to read.
 */
export function ScopedWorkItemPanel({ item }: { item: ArtifactsOnlyWorkItem }) {
  const { layoutKey } = useRailScope();
  return (
    <PanelShell title="Work item">
      <p className="px-3 pb-1 pt-3 text-list-row text-text-muted">{scopedViewNotice(item)}</p>
      <RailSection
        sectionId="scoped:artifacts"
        title="Shared with you"
        count={item.shared_artifacts.length}
      >
        {item.shared_artifacts.map((artifact) => (
          <ListRow
            key={artifact.id}
            leading={<FileText className="size-icon-sm text-text-passive" />}
            title={artifact.name}
            navigates
            onOpen={() =>
              openCenterTab(layoutKey, artifactPathTab(artifact.id, artifact.name), {
                preview: true,
              })
            }
          />
        ))}
      </RailSection>
    </PanelShell>
  );
}
