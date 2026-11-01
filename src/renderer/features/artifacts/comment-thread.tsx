import { useRef, useState } from 'react';
import {
  avatarColor,
  avatarInitialsClass,
  displayName,
  formatRelativeTime,
  initials,
} from './artifact-ui-utils';
import { MentionTextarea, type MentionTextareaHandle } from './mention-textarea';
import { describeCommentAnchorChange } from './page/comment-anchor-status';
import type { CommentThread } from './use-comments';

// Common shape shared by a thread root and its replies (both carry author/body/time).
type CommentLike = { author_name: string; body: string; created_at: string };

interface CommentThreadViewProps {
  workItemId: string;
  thread: CommentThread;
  onReply: (parentId: string, body: string, mentionedUserIds: string[]) => void;
  onResolve: (commentId: string) => void;
  onUnresolve: (commentId: string) => void;
  onSendToAgent?: (thread: CommentThread) => void;
}

// Avatar-feed comment thread matching the prototype: avatar column + name/time/body/actions,
// indented replies, resolved threads dimmed, anchored text shown as a quiet reference chip.
export function CommentThreadView({
  workItemId,
  thread,
  onReply,
  onResolve,
  onUnresolve,
  onSendToAgent,
}: CommentThreadViewProps) {
  const replyRef = useRef<MentionTextareaHandle>(null);
  const [replyEmpty, setReplyEmpty] = useState(true);
  const [showReply, setShowReply] = useState(false);
  const { root, replies } = thread;
  const resolved = root.resolved;

  const submitReply = (body: string, mentionedUserIds: string[]) => {
    onReply(root.id, body, mentionedUserIds);
    setShowReply(false);
  };

  return (
    <div className={resolved ? 'opacity-55' : ''}>
      <CommentBlock comment={root} size={28} bodyStrike={resolved}>
        {root.anchor_text && (
          <ReferenceChip
            text={root.anchor_text}
            change={describeCommentAnchorChange(root.anchorStatus)}
          />
        )}
        <div className="mt-2 flex items-center gap-3">
          {!resolved ? (
            <>
              <ActionLink onClick={() => setShowReply((v) => !v)}>Reply</ActionLink>
              <ActionLink onClick={() => onResolve(root.id)}>Resolve</ActionLink>
              {onSendToAgent && (
                <ActionLink className="ml-auto" onClick={() => onSendToAgent(thread)}>
                  Send to agent
                </ActionLink>
              )}
            </>
          ) : (
            <ActionLink onClick={() => onUnresolve(root.id)}>Re-open</ActionLink>
          )}
        </div>
      </CommentBlock>

      {replies.length > 0 && (
        <div className="mt-3 flex flex-col gap-3 pl-6">
          {replies.map((reply) => (
            <CommentBlock key={reply.id} comment={reply} size={24} />
          ))}
        </div>
      )}

      {showReply && (
        <div className="mt-2 flex flex-col gap-2 pl-9">
          {/* Same composer as a root comment, so a reply can @mention too. */}
          <MentionTextarea
            ref={replyRef}
            workItemId={workItemId}
            placeholder="Reply…"
            autoFocus
            onSubmit={submitReply}
            onCancel={() => setShowReply(false)}
            onEmptyChange={setReplyEmpty}
            className="w-full resize-none rounded-md border border-border bg-surface-raised px-2 py-2 text-body tracking-body text-text outline-none transition-colors placeholder:text-text-passive focus:border-border-strong"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowReply(false)}
              className="rounded-md px-2 py-1 text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:text-text-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => replyRef.current?.submit()}
              disabled={replyEmpty}
              className="rounded-lg bg-action-bg px-3 py-1 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentBlock({
  comment,
  size,
  bodyStrike,
  children,
}: {
  comment: CommentLike;
  size: number;
  bodyStrike?: boolean;
  children?: React.ReactNode;
}) {
  const name = displayName(comment.author_name);
  return (
    <div className="flex gap-3">
      <div
        className={`flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarInitialsClass(size)}`}
        style={{
          width: size,
          height: size,
          background: avatarColor(name),
        }}
      >
        {initials(comment.author_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body tracking-body font-semibold text-text">{name}</span>
          <span className="ml-auto flex-shrink-0 text-tiny tracking-tiny tabular-nums text-text-passive">
            {formatRelativeTime(comment.created_at)}
          </span>
        </div>
        <p
          className={`mt-1 text-body tracking-body leading-[1.55] text-text-muted ${bodyStrike ? 'line-through' : ''}`}
        >
          {comment.body}
        </p>
        {children}
      </div>
    </div>
  );
}

/** The quoted element; when the element no longer matches the quote, it says so under it. */
function ReferenceChip({ text, change }: { text: string; change: string | null }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-surface-raised px-2 py-2 text-tiny tracking-tiny leading-[1.4] text-text-passive">
      <span className="text-text-passive">Referenced:</span> &ldquo;{text}&rdquo;
      {change && <div className="mt-1 text-status-warn">{change}</div>}
    </div>
  );
}

function ActionLink({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-micro tracking-micro font-semibold text-text-passive transition-colors hover:text-status-ok-active ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
