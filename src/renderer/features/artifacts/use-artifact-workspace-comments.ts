import { useCallback, useEffect, type ComponentProps } from 'react';
import type { PickedElement } from '@shared/artifact-frame-messages';
import type { ArtifactPreviewBody } from './artifact-preview-body';
import type { CommentsCard } from './comments-card';
import { useComments } from './use-comments';
import { useCommentsCard } from './use-comments-card';
import { useWorkspaceCommentHandlers } from './use-workspace-comment-handlers';

type PreviewBodyProps = ComponentProps<typeof ArtifactPreviewBody>;

interface UseArtifactWorkspaceCommentsOptions {
  workItemId: string;
  artifactId: string;
  enabled: boolean;
  /** A local page's source, to verify element comments against; null otherwise. */
  pageSource: string | null;
  /** The agent runs on the author's device: only a local tab can talk to it. */
  agentActions: boolean;
  cardOpen: boolean;
  openCard: () => void;
  closeCard: () => void;
  onDocumentTouched?: () => void;
  /** How a thread is started on this artifact, for the card's empty state. */
  emptyHint: string;
  /** A comment a notification named: the card selects its thread once comments load. */
  focusCommentId: string | null;
  onFocusHandled: () => void;
}

/**
 * An artifact tab's comments, wired once for everything that shows them (S6):
 * the comments card, the page's pins and click-to-comment, and the
 * document's badges and selection comments.
 */
export function useArtifactWorkspaceComments({
  workItemId,
  artifactId,
  enabled,
  pageSource,
  agentActions,
  cardOpen,
  openCard,
  closeCard,
  onDocumentTouched,
  emptyHint,
  focusCommentId,
  onFocusHandled,
}: UseArtifactWorkspaceCommentsOptions) {
  const comments = useComments({ workItemId, artifactId, enabled, pageSource });
  const { handleCommentCreate, handleReply, handleAddComment, handleCommentOnElement } =
    useWorkspaceCommentHandlers({
      workItemId,
      addComment: comments.addComment,
      onDocumentTouched,
      onAnchoredCommentCreated: openCard,
    });
  const card = useCommentsCard({
    threads: comments.threads,
    loaded: comments.loaded,
    open: cardOpen,
    onOpen: openCard,
    focusCommentId,
    onFocusHandled,
  });

  // An open card has been read, including a comment that lands while it is
  // open (S8): the rail's and the bar's unread dot clear on the next summary.
  const { markRead } = comments;
  const newestCommentId = comments.comments[0]?.id ?? null;
  useEffect(() => {
    if (enabled && cardOpen && !comments.loading) void markRead();
  }, [enabled, cardOpen, comments.loading, newestCommentId, markRead]);

  const { sendElementToAgent, sendSelectionToAgent } = comments;
  const askAgentAboutElement = useCallback(
    (element: PickedElement, instruction: string) => {
      void sendElementToAgent({ element, instruction });
      onDocumentTouched?.();
    },
    [sendElementToAgent, onDocumentTouched]
  );

  const cardProps: ComponentProps<typeof CommentsCard> = {
    workItemId,
    visible: card.visible,
    counts: card.counts,
    filter: card.filter,
    onFilterChange: card.setFilter,
    selected: card.selected,
    onSelect: card.select,
    loading: comments.loading,
    error: comments.loadError,
    emptyHint,
    onClose: closeCard,
    onReply: (parentId, body, mentionedUserIds) =>
      void handleReply(parentId, body, mentionedUserIds),
    onResolve: (commentId) => void comments.resolveComment(commentId),
    onUnresolve: (commentId) => void comments.unresolveComment(commentId),
    onAddComment: (body, mentionedUserIds) => void handleAddComment(body, mentionedUserIds),
    onAddAllToChat: agentActions ? () => void comments.addAllToChat() : undefined,
    onSendThreadToAgent: agentActions
      ? (thread) => void comments.sendThreadToAgent(thread)
      : undefined,
  };

  const page: Omit<PreviewBodyProps['page'], 'mode' | 'source' | 'onTextEdited'> = {
    onAskAgent: agentActions ? askAgentAboutElement : undefined,
    onComment: handleCommentOnElement,
    pins: card.pins,
    selectedPin: card.selected,
    onPinSelected: card.selectNumber,
  };

  const document: Pick<
    PreviewBodyProps['document'],
    'onCommentCreate' | 'onAskAgent' | 'commentBadges'
  > = {
    onCommentCreate: enabled ? (comment) => void handleCommentCreate(comment) : undefined,
    onAskAgent: agentActions ? (request) => void sendSelectionToAgent(request) : undefined,
    commentBadges: card.documentBadges,
  };

  return { openCount: card.counts.open, cardProps, page, document };
}
