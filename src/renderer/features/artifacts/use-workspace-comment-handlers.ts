import { useCallback } from 'react';
import type { PickedElement } from '@shared/artifact-frame-messages';
import { cloudApi } from '@renderer/lib/cloud-api';
import { anchorKeyForPickedElement, referenceForPickedElement } from './page/picked-element';
import type { CreatedComment } from './use-comments';

interface NewComment {
  body: string;
  anchor_key?: string | null;
  anchor_text?: string | null;
  parent_comment_id?: string;
}

interface CommentHandlerOptions {
  workItemId: string;
  addComment: (comment: NewComment) => Promise<CreatedComment | null>;
  onDocumentTouched?: () => void;
  /** A new top-level anchored comment landed: the host shows the comments tab. */
  onAnchoredCommentCreated: () => void;
}

/**
 * The comment actions of an artifact workspace. Mentions are only announced
 * for a comment that actually landed in the store — notifying on a failed
 * write is what sent teammates to a comment that did not exist — and point at
 * it when it is in the cloud. A comment stored only on this machine (its
 * artifact is not in the cloud yet) has nothing to point at.
 */
export function useWorkspaceCommentHandlers({
  workItemId,
  addComment,
  onDocumentTouched,
  onAnchoredCommentCreated,
}: CommentHandlerOptions) {
  const notifyMentions = useCallback(
    async (userIds: string[], excerpt: string, comment: CreatedComment) => {
      if (userIds.length === 0) return;
      try {
        await cloudApi.notifyMentions(
          workItemId,
          userIds,
          excerpt,
          comment.inCloud ? { comment_id: comment.id } : null
        );
      } catch (e) {
        // The comment is already saved; mention delivery is a secondary signal,
        // so surface the failure rather than fail the comment — but never hide it.
        console.error('[mentions] failed to notify mentioned users:', e);
      }
    },
    [workItemId]
  );

  const handleCommentCreate = useCallback(
    async (data: {
      body: string;
      anchor_key: string | null;
      anchor_text: string | null;
      mentioned_user_ids: string[];
    }) => {
      const created = await addComment(data);
      if (!created) return;
      onDocumentTouched?.();
      await notifyMentions(data.mentioned_user_ids, data.body, created);
      onAnchoredCommentCreated();
    },
    [addComment, notifyMentions, onDocumentTouched, onAnchoredCommentCreated]
  );

  const handleReply = useCallback(
    async (parentId: string, body: string, mentionedUserIds: string[]) => {
      const created = await addComment({ body, parent_comment_id: parentId });
      if (!created) return;
      onDocumentTouched?.();
      await notifyMentions(mentionedUserIds, body, created);
    },
    [addComment, notifyMentions, onDocumentTouched]
  );

  const handleAddComment = useCallback(
    async (body: string, mentionedUserIds: string[]) => {
      const created = await addComment({ body, anchor_key: null, anchor_text: null });
      if (!created) return;
      onDocumentTouched?.();
      await notifyMentions(mentionedUserIds, body, created);
    },
    [addComment, notifyMentions, onDocumentTouched]
  );

  const handleCommentOnElement = useCallback(
    (element: PickedElement, body: string) => {
      void handleCommentCreate({
        body,
        anchor_key: anchorKeyForPickedElement(element),
        anchor_text: referenceForPickedElement(element),
        mentioned_user_ids: [],
      });
    },
    [handleCommentCreate]
  );

  return { handleCommentCreate, handleReply, handleAddComment, handleCommentOnElement };
}
