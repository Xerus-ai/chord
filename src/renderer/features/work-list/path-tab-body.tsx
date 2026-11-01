import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import { artifactStatusBadge } from '@renderer/features/artifacts/artifact-status';
import { useArtifactRailSummary } from '@renderer/features/artifacts/use-artifact-rail-summary';
import { useWorkItemArtifacts } from '@renderer/features/artifacts/use-work-item-artifacts';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { PathTab } from './center-tab';
import { LocalDiff } from './diff-viewer';
import { copyToClipboard } from './file-bar';
import { FileViewer } from './file-viewer';
import type { DocumentBodyContext } from './pane-host';
import { effectivePathMode, pathFormat, resolvePathModes } from './path-tab-modes';
import { PathTabView } from './path-tab-view';
import { RepoFilePreview } from './repo-file-preview';
import { useChangedPaths } from './use-changed-paths';
import { useWorkItemSource } from './work-item-source';

async function readContents(
  workItemId: string,
  tab: PathTab,
  artifactFilePath: string | null
): Promise<string> {
  if (tab.filePath !== undefined) {
    const result = await rpc.workItems.readRepoFile(workItemId, tab.filePath, tab.worktreeId);
    if (!result.success) throw new Error(`Could not read ${tab.filePath}: ${result.error.type}`);
    return result.data.content;
  }
  if (artifactFilePath === null) throw new Error(`${tab.title} has no file to copy`);
  const result = await rpc.artifacts.readFileContent({ filePath: artifactFilePath, workItemId });
  if (!result.success) throw new Error(result.error.message);
  return result.data.content;
}

/**
 * The owner's path tab: its modes from the checkout and the owner's
 * capabilities, its bodies from the local file and artifact
 * (`PathTabView` lays them out).
 */
export function PathTabBody({
  workItemId,
  tab,
  context,
}: {
  workItemId: string;
  tab: PathTab;
  context: DocumentBodyContext;
}) {
  const { capabilities } = useWorkItemSource();
  const artifacts = useWorkItemArtifacts(workItemId);
  const railSummary = useArtifactRailSummary(workItemId);
  const changedPaths = useChangedPaths(workItemId, tab.worktreeId);
  const artifact =
    tab.artifactId !== undefined
      ? (artifacts.data ?? []).find((row) => row.id === tab.artifactId)
      : undefined;

  // An artifact's format is its render class, known once the list has it.
  if (tab.artifactId !== undefined && !artifact) {
    return (
      <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
        {artifacts.isPending ? 'Loading…' : `${tab.title} is no longer an artifact`}
      </div>
    );
  }

  const format = pathFormat({
    filePath: tab.filePath,
    renderClass: artifact ? renderClassForArtifactType(artifact.type as ArtifactType) : undefined,
  });
  const allowed = artifact ? capabilities.documentModes : capabilities.fileModes;
  const resolved = resolvePathModes({
    format,
    hasFile: tab.filePath !== undefined,
    hasChanges: tab.filePath !== undefined && changedPaths.has(tab.filePath),
    allowed,
  });
  const mode = effectivePathMode(tab.mode, resolved);
  const modeSwitch = {
    modes: resolved.modes,
    mode,
    canEdit: allowed.includes('edit'),
    onChange: context.onModeChange,
  };
  const onCopyContents =
    format === 'binary'
      ? null
      : () =>
          void readContents(workItemId, tab, artifact?.filePath ?? null).then(
            (text) => copyToClipboard(text, 'contents'),
            (error: unknown) =>
              toast({
                title: 'Could not copy contents',
                description: String(error),
                variant: 'destructive',
              })
          );

  const modeBody =
    tab.filePath === undefined ? null : mode === 'diff' ? (
      <LocalDiff
        key={`diff:${tab.worktreeId ?? ''}:${tab.filePath}`}
        workItemId={workItemId}
        worktreeId={tab.worktreeId}
        filePath={tab.filePath}
      />
    ) : mode === 'edit' ? (
      <FileViewer
        key={`edit:${tab.worktreeId ?? ''}:${tab.filePath}`}
        workItemId={workItemId}
        worktreeId={tab.worktreeId}
        filePath={tab.filePath}
        line={tab.line}
        onEdited={context.onDocumentTouched}
      />
    ) : null;

  return (
    <PathTabView
      workItemId={workItemId}
      tab={tab}
      context={context}
      modeSwitch={modeSwitch}
      onCopyContents={onCopyContents}
      artifact={
        artifact
          ? {
              id: artifact.id,
              source: 'local',
              canDelete: capabilities.deleteArtifact,
              unreadComments: railSummary.counts.get(artifact.id)?.comments?.unread === true,
              status: artifactStatusBadge(artifact.status),
            }
          : null
      }
      modeBody={modeBody}
      previewBody={
        tab.filePath === undefined ? null : (
          <RepoFilePreview
            workItemId={workItemId}
            worktreeId={tab.worktreeId}
            filePath={tab.filePath}
            format={format}
          />
        )
      }
    />
  );
}
