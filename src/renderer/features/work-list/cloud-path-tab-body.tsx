import { artifactStatusBadge } from '@renderer/features/artifacts/artifact-status';
import { useCloudArtifactDetail } from '@renderer/features/artifacts/cloud/use-cloud-artifact';
import { useCloudArtifactRailSummary } from '@renderer/features/artifacts/use-artifact-rail-summary';
import { useCloudArtifactList } from '@renderer/features/cloud-source/use-cloud-artifact-list';
import { useCloudGitState } from '@renderer/features/cloud-source/use-cloud-git-state';
import type { PathTab } from './center-tab';
import { CloudDiff } from './cloud-diff';
import type { DocumentBodyContext } from './pane-host';
import { effectivePathMode, pathFormat, resolvePathModes } from './path-tab-modes';
import { PathTabView } from './path-tab-view';
import { useWorkItemSource } from './work-item-source';

/**
 * A teammate's path tab: its modes from the owner's pushed snapshot and the
 * teammate's capabilities, its bodies from the cloud (the artifact's own
 * cloud copy, the snapshot's diff). A teammate has no copy of the repo, so a
 * plain file is only its diff, and there is nothing to copy from.
 */
export function CloudPathTabBody({
  workItemId,
  tab,
  context,
}: {
  workItemId: string;
  tab: PathTab;
  context: DocumentBodyContext;
}) {
  const { capabilities } = useWorkItemSource();
  const isArtifact = tab.artifactId !== undefined;
  const detail = useCloudArtifactDetail(tab.artifactId ?? '', isArtifact);
  // Both are work_item: routes, which an artifacts-only viewer is refused.
  const summary = useCloudArtifactRailSummary(workItemId, isArtifact && capabilities.workItemRoom);
  const snapshot = useCloudGitState(workItemId, capabilities.workItemRoom).data;
  // The owner's status, from the list the owner's re-registers refetch.
  const listed = useCloudArtifactList(workItemId, { enabled: isArtifact }).data?.find(
    (a) => a.id === tab.artifactId
  );

  if (isArtifact && !detail.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
        {detail.error ? `Could not open ${tab.title}` : 'Loading…'}
      </div>
    );
  }

  const format = pathFormat({ filePath: tab.filePath, renderClass: detail.data?.render_class });
  const allowed = isArtifact ? capabilities.documentModes : capabilities.fileModes;
  const resolved = resolvePathModes({
    format,
    hasFile: tab.filePath !== undefined,
    hasChanges:
      tab.filePath !== undefined && (snapshot?.files ?? []).some((f) => f.path === tab.filePath),
    allowed,
  });
  const mode = effectivePathMode(tab.mode, resolved);

  return (
    <PathTabView
      workItemId={workItemId}
      tab={tab}
      context={context}
      modeSwitch={{
        modes: resolved.modes,
        mode,
        canEdit: allowed.includes('edit'),
        onChange: context.onModeChange,
      }}
      onCopyContents={null}
      artifact={
        tab.artifactId !== undefined
          ? {
              id: tab.artifactId,
              source: 'cloud',
              canDelete: capabilities.deleteArtifact,
              unreadComments: summary.get(tab.artifactId)?.unread === true,
              status: artifactStatusBadge(listed?.status ?? null),
            }
          : null
      }
      modeBody={
        tab.filePath !== undefined && mode === 'diff' ? (
          <CloudDiff key={tab.filePath} workItemId={workItemId} filePath={tab.filePath} />
        ) : null
      }
      previewBody={null}
    />
  );
}
