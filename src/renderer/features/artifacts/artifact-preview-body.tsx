import type { PageMode } from '@shared/artifact-frame-constants';
import type { PagePin, PickedElement } from '@shared/artifact-frame-messages';
import { ArtifactEditor } from './artifact-editor';
import type { ArtifactSource, ArtifactSurface } from './artifact-surface';
import { CloudPageView } from './cloud/cloud-page-view';
import { ArtifactFileView } from './file/artifact-file-view';
import { artifactFileTarget } from './file/file-target';
import { ArtifactPageView } from './page/artifact-page-view';
import type { ArtifactVersion } from './use-versions';
import { VersionPreview } from './version-preview';

type EditorProps = Parameters<typeof ArtifactEditor>[0];

/**
 * An artifact's Preview, by surface (`resolveArtifactSurface`): a binary's
 * file viewer, a cloud page's uploaded view, a local page's live frame, an
 * old document version, or the co-edited document itself.
 */
export function ArtifactPreviewBody({
  surface,
  source,
  workItemId,
  artifactId,
  title,
  versions,
  page,
  document,
}: {
  surface: ArtifactSurface;
  source: ArtifactSource;
  workItemId: string;
  artifactId: string;
  title: string;
  versions: {
    latestId: string | null;
    preview: ArtifactVersion | null;
    /** A document version's HTML while it is previewed; null otherwise. */
    previewHtml: string | null;
    reloadSignal: number;
  };
  page: {
    mode: PageMode;
    /** The local page's source as it is now. */
    source: string;
    onTextEdited: (pageSource: string) => void;
    onAskAgent?: (element: PickedElement, instruction: string) => void;
    onComment: Parameters<typeof ArtifactPageView>[0]['onComment'];
    pins: PagePin[];
    selectedPin: number | null;
    onPinSelected: (n: number) => void;
  };
  document: {
    content: string;
    onUpdate: (html: string) => void;
    onDocumentReady: (html: string) => void;
    editable: boolean;
    hasCloudCopy: boolean;
    onCommentCreate: EditorProps['onCommentCreate'];
    onAskAgent: EditorProps['onAskAgent'];
    commentBadges: EditorProps['commentBadges'];
    replacement: EditorProps['replacement'];
    onReplaced: EditorProps['onReplaced'];
  };
}) {
  const { preview, previewHtml } = versions;
  if (surface.fileView) {
    return (
      <ArtifactFileView
        target={artifactFileTarget({
          source: surface.fileView,
          workItemId,
          artifactId,
          name: title,
          versionId: preview?.id,
        })}
        title={title}
        reloadKey={`${versions.latestId ?? 'none'}:${versions.reloadSignal}`}
      />
    );
  }
  if (surface.pageFrame === 'cloud') {
    return (
      <CloudPageView
        workItemId={workItemId}
        artifactId={artifactId}
        title={title}
        previewVersion={preview}
        reloadSignal={versions.reloadSignal}
        mode={page.mode}
        onAskAgent={page.onAskAgent}
        onComment={page.onComment}
        pins={page.pins}
        selectedPin={page.selectedPin}
        onPinSelected={page.onPinSelected}
      />
    );
  }
  if (surface.pageFrame === 'local') {
    return (
      <ArtifactPageView
        artifactId={artifactId}
        title={title}
        previewVersion={preview}
        mode={page.mode}
        source={page.source}
        onTextEdited={page.onTextEdited}
        onAskAgent={page.onAskAgent}
        onComment={page.onComment}
        pins={page.pins}
        selectedPin={page.selectedPin}
        onPinSelected={page.onPinSelected}
      />
    );
  }
  if (preview && previewHtml) {
    return <VersionPreview html={previewHtml} />;
  }
  return (
    <ArtifactEditor
      content={document.content}
      onUpdate={document.onUpdate}
      onDocumentReady={document.onDocumentReady}
      placeholder="Type '/' for commands…"
      editable={document.editable}
      artifactId={artifactId}
      roomId={artifactId}
      hasCloudCopy={document.hasCloudCopy}
      borderless
      workItemId={workItemId}
      source={source}
      pushAgentContent={surface.pushAgentContent}
      onCommentCreate={document.onCommentCreate}
      onAskAgent={document.onAskAgent}
      commentBadges={document.commentBadges}
      replacement={document.replacement}
      onReplaced={document.onReplaced}
    />
  );
}
