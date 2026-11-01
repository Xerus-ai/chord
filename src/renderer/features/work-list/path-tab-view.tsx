import { lazy, Suspense, type ReactNode } from 'react';
import type { PathTab } from './center-tab';
import { FileBar, type FileBarModeSwitch, type FileBarStatus } from './file-bar';
import type { DocumentBodyContext } from './pane-host';

// The artifact workspace carries the document editor (tiptap, prosemirror,
// yjs, lowlight): a chunk of its own, fetched the first time an artifact tab
// opens instead of parsed with the app at startup.
const ArtifactWorkspace = lazy(() =>
  import('@renderer/features/artifacts/artifact-workspace').then((module) => ({
    default: module.ArtifactWorkspace,
  }))
);

/** The artifact a path tab shows, when it is one. */
export interface PathTabArtifact {
  id: string;
  source: 'local' | 'cloud';
  canDelete: boolean;
  unreadComments: boolean;
  status: FileBarStatus | null;
}

/**
 * A path tab (design 2026-09-26 §3), the same for the owner and a teammate:
 * the file bar over the body of the tab's mode. An artifact renders inside its
 * workspace, which keeps its comments and versions on the bar in every mode;
 * a plain file renders here. The containers (`PathTabBody`,
 * `CloudPathTabBody`) decide the modes and build the bodies from their source.
 */
export function PathTabView({
  workItemId,
  tab,
  context,
  modeSwitch,
  onCopyContents,
  artifact,
  modeBody,
  previewBody,
}: {
  workItemId: string;
  tab: PathTab;
  context: DocumentBodyContext;
  modeSwitch: FileBarModeSwitch;
  onCopyContents: (() => void) | null;
  artifact: PathTabArtifact | null;
  /** The body outside Preview (Diff, Edit); null when the tab is in Preview. */
  modeBody: ReactNode;
  /** A plain file's Preview; an artifact previews itself. */
  previewBody: ReactNode;
}) {
  if (artifact) {
    return (
      <div data-testid="path-tab-body" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={null}>
          <ArtifactWorkspace
            key={artifact.id}
            source={artifact.source}
            workItemId={workItemId}
            artifactId={artifact.id}
            title={tab.title}
            onDocumentTouched={context.onDocumentTouched}
            canDelete={artifact.canDelete}
            unreadComments={artifact.unreadComments}
            bar={{ filePath: tab.filePath, modeSwitch, onCopyContents, status: artifact.status }}
            modeBody={modeBody}
          />
        </Suspense>
      </div>
    );
  }
  if (tab.filePath === undefined) {
    throw new Error(`Path tab "${tab.title}" has neither a file nor an artifact`);
  }
  return (
    <div
      data-testid="path-tab-body"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface"
    >
      <FileBar
        filePath={tab.filePath}
        title={tab.title}
        modeSwitch={modeSwitch}
        onCopyContents={onCopyContents}
      />
      {modeSwitch.mode === 'preview' ? previewBody : modeBody}
    </div>
  );
}
