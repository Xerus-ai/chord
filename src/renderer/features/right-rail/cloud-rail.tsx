import type { CloudGitStateMeta } from '@chord/protocol';
import { useMemo } from 'react';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { useWorkItemSource } from '@renderer/features/work-list/work-item-source';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { StatusBand } from './band/band';
import { cloudBandState } from './band/cloud-band-state';
import { CloudChecksPrPanel } from './checks-pr/cloud-panel';
import { RailPanels, WorkItemRail } from './rail';
import type { RailScope } from './rail-context';
import type { RailPanelId } from './rail-store';
import { CloudSourceControlPanel } from './source-control/cloud-panel';
import { CloudWorkItemPanel } from './work-item/cloud-panel';

const NO_SIGNALS: Partial<Record<RailPanelId, never>> = {};

/**
 * A teammate's rail: the owner's band and panels over the snapshot the owner
 * pushed. There is no checkout here, so no Files tab (`capabilities.railPanels`)
 * and no action on the band; "Last synced" says how old the view is.
 */
export function CloudWorkItemRail({
  item,
  ownerLabel,
  gitState,
  gitStatePending,
  gitStateError,
  viewers,
  selectedFile,
  onFileSelect,
}: {
  item: CloudWorkItem;
  ownerLabel: string | null;
  gitState: CloudGitStateMeta | null | undefined;
  gitStatePending: boolean;
  gitStateError: boolean;
  viewers: WorkItemViewer[];
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
}) {
  const { layoutKey } = useWorkItemSource();
  const scope = useMemo<RailScope>(
    () => ({ workItemId: item.id, layoutKey, worktreeId: null }),
    [item.id, layoutKey]
  );

  const renderPanel = (panel: RailPanelId) => {
    switch (panel) {
      case 'work-item':
        return <CloudWorkItemPanel item={item} />;
      case 'source-control':
        return (
          <CloudSourceControlPanel
            gitState={gitState}
            isPending={gitStatePending}
            hasError={gitStateError}
            ownerLabel={ownerLabel}
            viewers={viewers}
            selectedFile={selectedFile}
            onFileSelect={onFileSelect}
          />
        );
      case 'checks-pr':
        return <CloudChecksPrPanel item={item} gitState={gitState} />;
      case 'explorer':
        throw new Error('A teammate has no Files panel: it needs the checkout');
    }
  };

  return (
    <WorkItemRail scope={scope}>
      <StatusBand
        workItemId={item.id}
        state={cloudBandState(gitState, item)}
        prNumber={item.pr_number}
        prUrl={item.pr_url}
        actions={null}
        syncedAt={gitState?.captured_at ?? null}
      />
      <RailPanels
        signals={NO_SIGNALS}
        counts={{ 'source-control': gitState?.files.length ?? 0 }}
        renderPanel={renderPanel}
      />
    </WorkItemRail>
  );
}
