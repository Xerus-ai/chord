import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PageMode } from '@shared/artifact-frame-constants';
import { useRegisterPublishable } from '@renderer/features/confluence/use-register-publishable';
import {
  FileBar,
  type FileBarCard,
  type FileBarModeSwitch,
  type FileBarStatus,
} from '@renderer/features/work-list/file-bar';
import { useWorkItemViewers } from '@renderer/features/work-list/use-viewing-presence';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ArtifactBarTrailing } from './artifact-bar-controls';
import { takeArtifactCardRequest, useArtifactCardRequests } from './artifact-card-request';
import { ArtifactDriftNotice } from './artifact-drift-notice';
import { ArtifactLoadError } from './artifact-load-error';
import { artifactPresenceFile } from './artifact-presence';
import { ArtifactPreviewBody } from './artifact-preview-body';
import { ArtifactSourceContext } from './artifact-source-context';
import type { ArtifactSource } from './artifact-surface';
import { useCloudVersionEvents } from './cloud/use-cloud-version-events';
import { canMentionInComments, CommentMentionsContext } from './comment-mentions';
import { CommentsCard } from './comments-card';
import { commentsEmptyHint } from './comments-empty-hint';
import { useArtifactRestore } from './use-artifact-restore';
import { useWatchArtifactSourceDrift } from './use-artifact-source-drift';
import { useArtifactWorkspaceComments } from './use-artifact-workspace-comments';
import { useArtifactWorkspaceSource } from './use-artifact-workspace-source';
import { useArtifactWorkspaceVersions } from './use-artifact-workspace-versions';
import { useDeleteArtifact } from './use-delete-artifact';
import { VersionsCard } from './versions-card';

interface ArtifactWorkspaceProps {
  /**
   * Where the artifact is read from: `local` for the author's own work item on
   * this device, `cloud` for a teammate's or an artifact shared on its own.
   * Required — a missing local row never falls back to the cloud.
   */
  source: ArtifactSource;
  workItemId: string;
  artifactId: string;
  title: string;
  /**
   * The user did something that commits to this document — typed in it,
   * commented, saved a version. A preview tab promotes to a permanent one.
   */
  onDocumentTouched?: () => void;
  /** The author's own view (the local work item): offers Delete for everyone. */
  canDelete?: boolean;
  /**
   * Someone else commented since the caller last read (S8), from the work
   * item's rail summary. Only the owner's local tab has one; an artifact
   * shared alone has no work-item summary to read it from.
   */
  unreadComments?: boolean;
  /** The path tab's file bar: where the artifact lives, its modes, and copying it. */
  bar: {
    filePath?: string;
    modeSwitch: FileBarModeSwitch;
    onCopyContents: (() => void) | null;
    /** The artifact's status (artifact-status.ts); null when it has none. */
    status: FileBarStatus | null;
  };
  /**
   * What the tab shows outside Preview (Diff, Edit). The artifact stays
   * mounted, so its comments and versions stay on the bar in every mode.
   */
  modeBody?: ReactNode;
}

/**
 * An artifact as a centre tab. Owns content, comments, versions and editable
 * state, so the editor and sidebar always share one set of hooks — which is
 * what makes text-selection comments reach the sidebar. Which parts exist is
 * the artifact's surface (`resolveArtifactSurface`): a cloud artifact has no
 * drift notice, no in-place edit and no agent push.
 */
export function ArtifactWorkspace({
  source,
  workItemId,
  artifactId,
  title,
  onDocumentTouched,
  canDelete = false,
  unreadComments = false,
  bar,
  modeBody,
}: ArtifactWorkspaceProps) {
  const { requestDelete } = useDeleteArtifact({ workItemId, artifactId, title });
  // `content` mirrors the live document: the editor reports its serialized HTML
  // on every transaction, local or remote. It is the artifact as it currently
  // reads, which is what a manual version must snapshot.
  const {
    content,
    loading,
    error: contentError,
    retry: retryContent,
    setContent,
    renderClass,
    artifactType,
    hasWorkItemAccess,
    surface,
    hasCloudCopy,
  } = useArtifactWorkspaceSource(source, artifactId, workItemId);
  const isPage = renderClass === 'page';
  // A document's `content` is only the file's seed until its editor holds the
  // real document (the collab server's copy, or the applied seed). Nothing is
  // published or compared against Confluence before then.
  const [readyDocumentId, setReadyDocumentId] = useState<string | null>(null);
  const handleDocumentReady = useCallback(
    (html: string) => {
      setContent(html);
      setReadyDocumentId(artifactId);
    },
    [setContent, artifactId]
  );
  const resetDocumentReady = useCallback(() => setReadyDocumentId(null), []);
  const publishableContent = isPage || readyDocumentId === artifactId ? content : null;
  // The bar's 💬 and 🕘 open one card at a time, on demand (design 2026-09-26 §3).
  const [activeCard, setActiveCard] = useState<FileBarCard | null>(null);
  const toggleCard = useCallback(
    (card: FileBarCard) => setActiveCard((open) => (open === card ? null : card)),
    []
  );
  // "Open with this card" from the rail or a notification, taken once: one
  // made before this tab mounted, and any made while it is open. A comment's
  // notification also names the thread to select.
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const clearFocusComment = useCallback(() => setFocusCommentId(null), []);
  useEffect(() => {
    const take = () => {
      const request = takeArtifactCardRequest(artifactId);
      if (!request) return;
      setActiveCard(request.card);
      setFocusCommentId(request.commentId);
    };
    take();
    return useArtifactCardRequests.subscribe(take);
  }, [artifactId]);

  const enabled = !!(workItemId && artifactId);
  useWatchArtifactSourceDrift(enabled && source === 'local' ? workItemId : null);
  // The agent runs on the author's device: only a local tab can talk to it.
  const agentActions = enabled && source === 'local';

  const openComments = useCallback(() => setActiveCard('comments'), []);
  const closeCard = useCallback(() => setActiveCard(null), []);
  const comments = useArtifactWorkspaceComments({
    workItemId,
    artifactId,
    enabled,
    // Only a local page has a source to verify element comments against.
    pageSource: isPage && source === 'local' ? content : null,
    agentActions,
    cardOpen: activeCard === 'comments',
    openCard: openComments,
    closeCard,
    onDocumentTouched,
    emptyHint: commentsEmptyHint({ renderClass, pageModes: surface?.pageModes ?? [] }),
    focusCommentId,
    onFocusHandled: clearFocusComment,
  });

  const {
    versions,
    loadError: versionsError,
    previewVersion,
    previewHtml,
    previewVersionSnapshot,
    clearPreview,
    saveVersion,
    refetch: refetchVersions,
  } = useArtifactWorkspaceVersions({
    source,
    workItemId,
    artifactId,
    enabled,
    previewAsDocument: renderClass === 'document',
  });
  const handleVersionsChanged = useCallback(() => void refetchVersions(), [refetchVersions]);
  const reloadSignal = useCloudVersionEvents({
    artifactId,
    renderClass,
    enabled: enabled && source === 'cloud',
    onVersionsChanged: handleVersionsChanged,
  });

  // Presence is collected for the whole work item, and every surface advertises
  // itself through `file`. The toolbar's avatars mean "who else is in THIS
  // document", so peers sitting on the work item's diff or chat are filtered
  // out. Someone the artifact alone was shared with has no work-item presence.
  const surfaceKey = artifactPresenceFile(artifactId);
  const presenceWorkItemId = hasWorkItemAccess ? workItemId : undefined;
  const workItemViewers = useWorkItemViewers(presenceWorkItemId);
  const viewers = useMemo(
    () => workItemViewers.filter((viewer) => viewer.file === surfaceKey),
    [workItemViewers, surfaceKey]
  );

  const restore = useArtifactRestore({
    artifactId,
    // Only the author's own copy restores: a teammate views history.
    canRestore: enabled && source === 'local',
    isDocument: renderClass === 'document',
    versions,
    previewVersion,
    previewHtml,
    clearPreview,
    refetchVersions,
    saveVersion,
    resetDocumentReady,
    onDocumentTouched,
  });

  // An in-place edit is already on disk and saved as a version by main.
  const handlePageTextEdited = useCallback(
    (pageSource: string) => {
      setContent(pageSource);
      void refetchVersions();
      onDocumentTouched?.();
    },
    [setContent, refetchVersions, onDocumentTouched]
  );

  const handleSaveVersion = useCallback(() => {
    void saveVersion(content);
    onDocumentTouched?.();
    setActiveCard('versions');
  }, [content, saveVersion, onDocumentTouched]);

  // A Confluence publish saves the published content as a version.
  const handleConfluencePublished = useCallback(() => {
    void refetchVersions();
  }, [refetchVersions]);
  // The owner publishes from the Share dialog's Publish tab, which reads
  // what this tab would send.
  const showShare = useShowModal('shareModal');
  useRegisterPublishable(
    artifactId,
    { artifactType, content: publishableContent, onPublished: handleConfluencePublished },
    !previewVersion && !!surface?.showConfluencePublish
  );

  // A page version previews in its own sandbox frame; a document's through the editor.
  const previewing = !!previewVersion && (isPage || !!previewHtml);
  const canEdit = !!surface && !surface.readOnly;
  const pageModes = surface?.pageModes ?? [];
  // With the comments card open a click comments on what it lands on;
  // otherwise an owner's web page edits text on a double-click.
  const pageMode: PageMode =
    activeCard === 'comments' && pageModes.includes('pick')
      ? 'pick'
      : pageModes.includes('edit-text')
        ? 'edit-text'
        : 'view';
  const inPreview = bar.modeSwitch.mode === 'preview';
  const mentionsEnabled = canMentionInComments({ source, hasWorkItemAccess });

  return (
    <ArtifactSourceContext.Provider value={source}>
      <CommentMentionsContext.Provider value={mentionsEnabled}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          <FileBar
            filePath={bar.filePath}
            title={title}
            modeSwitch={bar.modeSwitch}
            onCopyContents={bar.onCopyContents}
            status={bar.status}
            artifact={{
              openComments: comments.openCount,
              unreadComments,
              versionNumber: previewVersion?.version_number ?? versions[0]?.version_number ?? null,
              activeCard,
              onToggleCard: toggleCard,
            }}
            viewing={
              previewVersion
                ? {
                    versionNumber: previewVersion.version_number ?? null,
                    onBackToLatest: clearPreview,
                    onRestore: restore.onRestore,
                  }
                : undefined
            }
            trailing={
              <ArtifactBarTrailing
                viewers={viewers}
                confluence={
                  // A preview shows an old version; publishing always sends the current one.
                  !previewVersion && surface?.showConfluencePublish
                    ? {
                        artifactId,
                        artifactType,
                        content: publishableContent,
                        onPublished: handleConfluencePublished,
                        onOpenPublish: () => showShare({ workItemId, artifactId, tab: 'publish' }),
                      }
                    : undefined
                }
                onSaveVersion={surface?.saveVersion ? handleSaveVersion : undefined}
                onDelete={canDelete ? () => void requestDelete() : undefined}
              />
            }
          />

          <div className="relative flex min-h-0 flex-1">
            {/* Typing in the document promotes a preview tab to a permanent one. */}
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onKeyDownCapture={canEdit && !isPage ? onDocumentTouched : undefined}
            >
              {!inPreview && modeBody}
              {surface?.showDriftNotice && (
                <ArtifactDriftNotice workItemId={workItemId} artifactId={artifactId} layout="bar" />
              )}
              {inPreview && contentError && (
                <ArtifactLoadError message={contentError} onRetry={retryContent} />
              )}
              {!inPreview || (contentError && !surface) ? null : loading || !surface ? (
                <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
                  Loading document…
                </div>
              ) : (
                <ArtifactPreviewBody
                  surface={surface}
                  source={source}
                  workItemId={workItemId}
                  artifactId={artifactId}
                  title={title}
                  versions={{
                    latestId: versions[0]?.id ?? null,
                    preview: previewVersion,
                    previewHtml: previewing ? previewHtml : null,
                    reloadSignal,
                  }}
                  page={{
                    mode: pageMode,
                    source: content,
                    onTextEdited: handlePageTextEdited,
                    ...comments.page,
                  }}
                  document={{
                    content,
                    onUpdate: setContent,
                    onDocumentReady: handleDocumentReady,
                    editable: canEdit,
                    hasCloudCopy,
                    ...comments.document,
                    // Only an editor that holds the true document takes a restore.
                    replacement: readyDocumentId === artifactId ? restore.replacement : null,
                    onReplaced: restore.onReplaced,
                  }}
                />
              )}
            </div>

            {activeCard === 'comments' && <CommentsCard {...comments.cardProps} />}
            {activeCard === 'versions' && (
              <VersionsCard
                versions={versions}
                error={versionsError}
                previewVersion={previewVersion}
                onPreview={previewVersionSnapshot}
                onBackToLatest={clearPreview}
                onClose={closeCard}
              />
            )}
          </div>
        </div>
      </CommentMentionsContext.Provider>
    </ArtifactSourceContext.Provider>
  );
}
