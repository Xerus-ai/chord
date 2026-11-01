import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { displayName } from './artifact-ui-utils';
import { Avatar, EmptyState, PanelError } from './card-primitives';
import type { CommentFilter, NumberedThread } from './comment-numbering';
import { CommentThreadView } from './comment-thread';
import { MentionTextarea, type MentionTextareaHandle } from './mention-textarea';
import { describeCommentAnchorChange } from './page/comment-anchor-status';
import type { CommentThread } from './use-comments';

interface CommentsCardProps {
  workItemId: string;
  /** The threads under the current filter, numbered (comment-numbering.ts). */
  visible: NumberedThread[];
  counts: Record<CommentFilter, number>;
  filter: CommentFilter;
  onFilterChange: (filter: CommentFilter) => void;
  selected: number | null;
  onSelect: (n: number | null) => void;
  loading: boolean;
  /** Why the comment list could not be read, when it could not be read. */
  error: string | null;
  /** How a thread is started on this artifact, for the empty state. */
  emptyHint: string;
  onClose: () => void;
  onReply: (parentId: string, body: string, mentionedUserIds: string[]) => void;
  onResolve: (commentId: string) => void;
  onUnresolve: (commentId: string) => void;
  onAddComment: (body: string, mentionedUserIds: string[]) => void;
  onAddAllToChat?: () => void;
  onSendThreadToAgent?: (thread: CommentThread) => void;
}

const FILTERS: { id: CommentFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
];

/**
 * The comments card (shared-items step 1, S6; design 2026-09-26 §3). It
 * floats at the content's top right. Each thread shows the number its pin or
 * badge carries, and selecting one expands it with reply, resolve and "Send
 * to agent". A comment that is not on anything is written at the bottom.
 */
export function CommentsCard({
  workItemId,
  visible,
  counts,
  filter,
  onFilterChange,
  selected,
  onSelect,
  loading,
  error,
  emptyHint,
  onClose,
  onReply,
  onResolve,
  onUnresolve,
  onAddComment,
  onAddAllToChat,
  onSendThreadToAgent,
}: CommentsCardProps) {
  return (
    <div
      className="absolute right-3 top-3 z-30 flex max-h-[calc(100%-24px)] w-[340px] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-2xl"
      data-testid="comments-card"
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-body tracking-body font-semibold text-text">Comments</span>
        <span className="flex-1" />
        <div className="flex rounded-md bg-surface-inset p-0.5">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => onFilterChange(id)}
              aria-pressed={filter === id}
              className={`rounded px-2 py-0.5 text-tiny tracking-tiny font-medium transition-colors ${
                filter === id ? 'bg-surface-raised text-text' : 'text-text-passive hover:text-text'
              }`}
            >
              {label}
              {counts[id] > 0 && <span className="ml-1 tabular-nums">{counts[id]}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close comments"
          className="rounded p-1 text-text-passive transition-colors hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-[120px] flex-1 flex-col overflow-y-auto p-2">
        {loading ? (
          <p className="py-6 text-center text-tiny tracking-tiny text-text-passive">
            Loading comments…
          </p>
        ) : error ? (
          <PanelError message={error} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={filter === 'open' ? 'No comments yet' : 'No resolved comments'}
            body={filter === 'open' ? emptyHint : 'Resolved threads show here.'}
            icon={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
          />
        ) : (
          visible.map(({ n, thread }) =>
            n === selected ? (
              <div
                key={thread.root.id}
                className="rounded-lg border border-border bg-surface p-2"
                data-comment-thread={n}
                data-selected="true"
                ref={scrollSelectedThreadIntoView}
              >
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="mb-2 flex w-full items-center gap-2 text-left"
                >
                  <ThreadNumber n={n} selected />
                  <ChangedTag thread={thread} />
                </button>
                <CommentThreadView
                  workItemId={workItemId}
                  thread={thread}
                  onReply={onReply}
                  onResolve={onResolve}
                  onUnresolve={onUnresolve}
                  onSendToAgent={onSendThreadToAgent}
                />
              </div>
            ) : (
              <ThreadRow key={thread.root.id} n={n} thread={thread} onSelect={onSelect} />
            )
          )
        )}
      </div>

      {filter === 'open' && counts.open > 0 && onAddAllToChat && (
        <div className="flex flex-shrink-0 justify-end px-3 pb-1">
          <button
            type="button"
            onClick={onAddAllToChat}
            className="text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:text-text"
          >
            Add all open comments to chat
          </button>
        </div>
      )}
      <GeneralComposer workItemId={workItemId} onSubmit={onAddComment} />
    </div>
  );
}

/**
 * A thread selected from outside the card (a pin, a notification) may be below
 * the fold. Stable, so it runs when the selected thread mounts, not on every
 * render.
 */
function scrollSelectedThreadIntoView(el: HTMLDivElement | null): void {
  el?.scrollIntoView({ block: 'nearest' });
}

function ThreadNumber({ n, selected = false }: { n: number; selected?: boolean }) {
  return (
    <span
      className={`flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full rounded-bl-sm border px-1 text-micro tracking-micro font-semibold tabular-nums ${
        selected
          ? 'border-action-bg bg-action-bg text-action-fg'
          : 'border-border-strong bg-surface-raised text-text'
      }`}
    >
      {n}
    </span>
  );
}

/** "Element changed" when a page element no longer matches what the comment quoted. */
function ChangedTag({ thread }: { thread: CommentThread }) {
  const change = describeCommentAnchorChange(thread.root.anchorStatus);
  if (!change) return null;
  return (
    <span
      title={change}
      className="flex-shrink-0 rounded bg-status-warn-bg px-1.5 py-0.5 text-micro tracking-micro font-medium text-status-warn"
    >
      Element changed
    </span>
  );
}

function ThreadRow({
  n,
  thread,
  onSelect,
}: {
  n: number;
  thread: CommentThread;
  onSelect: (n: number) => void;
}) {
  const name = displayName(thread.root.author_name);
  const firstLine = thread.root.body.split('\n')[0];
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      data-comment-thread={n}
      className="flex w-full gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-inset"
    >
      <ThreadNumber n={n} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Avatar name={name} size={16} />
          <span className="truncate text-tiny tracking-tiny font-semibold text-text">{name}</span>
          {thread.replies.length > 0 && (
            <span className="text-micro tracking-micro text-text-passive">
              {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
            </span>
          )}
          <span className="flex-1" />
          <ChangedTag thread={thread} />
        </span>
        <span className="mt-0.5 block truncate text-tiny tracking-tiny text-text-muted">
          {firstLine}
        </span>
      </span>
    </button>
  );
}

function GeneralComposer({
  workItemId,
  onSubmit,
}: {
  workItemId: string;
  onSubmit: (body: string, mentionedUserIds: string[]) => void;
}) {
  const composerRef = useRef<MentionTextareaHandle>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  return (
    <div className="flex flex-shrink-0 items-end gap-2 border-t border-border-subtle p-2">
      <div className="flex-1">
        <MentionTextarea
          ref={composerRef}
          workItemId={workItemId}
          placeholder="Comment on the file…"
          onSubmit={onSubmit}
          onEmptyChange={setIsEmpty}
          className="min-h-[36px] w-full resize-none rounded-md border border-border bg-surface-inset px-2 py-1.5 text-body tracking-body text-text outline-none transition-colors placeholder:text-text-passive focus:border-border-strong"
        />
      </div>
      <button
        type="button"
        onClick={() => composerRef.current?.submit()}
        disabled={isEmpty}
        className="rounded-lg bg-action-bg px-3 py-1.5 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:cursor-not-allowed disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
      >
        Post
      </button>
    </div>
  );
}
