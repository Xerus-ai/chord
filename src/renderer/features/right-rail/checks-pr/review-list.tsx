import { FileText } from 'lucide-react';
import type { PullRequestReview, PullRequestReviewComment } from '@shared/pull-requests';
import { ListRow, RowActions } from '@renderer/lib/components/list-row';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { RailEmpty, RailSection } from '../rail-primitives';

type ReviewState = PullRequestReview['state'];

const STATE_LABEL: Record<ReviewState, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  PENDING: 'Pending',
  COMMENTED: 'Commented',
  DISMISSED: 'Dismissed',
};

const STATE_SIGNAL: Record<ReviewState, StatusSignal> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'danger',
  PENDING: 'neutral',
  COMMENTED: 'neutral',
  DISMISSED: 'neutral',
};

function ReviewerAvatar({ url, login }: { url: string | null; login: string }) {
  if (url) return <img src={url} alt="" className="size-icon-lg shrink-0 rounded-full" />;
  return (
    <span className="flex size-icon-lg shrink-0 items-center justify-center rounded-full bg-surface-hover-solid text-avatar-sm font-medium text-text-muted">
      {login.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Reviewers and their comments, with the two handoffs the design names: every
 * comment can go to the agent as context, and a "changes requested" review can
 * be handed over whole as work to do.
 *
 * The state label carries the status token as text on the row's own surface —
 * a pill per reviewer would put five tinted slabs in a 360px column.
 */
export function ReviewList({
  reviews,
  onAddToChat,
  onFixWithAi,
}: {
  reviews: PullRequestReview[];
  onAddToChat: (reviews: PullRequestReview[]) => void;
  onFixWithAi: (reviews: PullRequestReview[]) => void;
}) {
  const comments = reviews.flatMap((review) => review.comments);
  const blocking = reviews.filter((review) => review.state === 'CHANGES_REQUESTED');

  return (
    <>
      <RailSection sectionId="checks-pr:reviewers" title="Reviewers" count={reviews.length}>
        {reviews.length === 0 ? (
          <RailEmpty>No reviews yet</RailEmpty>
        ) : (
          <>
            <div className="flex gap-1.5 px-3 pb-1">
              <button
                type="button"
                onClick={() => onAddToChat(reviews)}
                className="cursor-pointer rounded-xs border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-inset"
              >
                Add to chat
              </button>
              {blocking.length > 0 && (
                <button
                  type="button"
                  onClick={() => onFixWithAi(blocking)}
                  className="cursor-pointer rounded-xs border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-inset"
                >
                  Fix with AI
                </button>
              )}
            </div>
            {reviews.map((review) => (
              <ListRow
                key={review.id}
                leading={
                  <ReviewerAvatar
                    url={review.reviewerAvatarUrl ?? null}
                    login={review.reviewerLogin}
                  />
                }
                title={review.reviewerLogin}
                trailing={
                  <span
                    className={`shrink-0 text-tiny tracking-tiny font-medium ${statusTextClass(STATE_SIGNAL[review.state])}`}
                  >
                    {STATE_LABEL[review.state]}
                  </span>
                }
              />
            ))}
          </>
        )}
      </RailSection>

      <RailSection
        sectionId="checks-pr:comments"
        title="Comments"
        count={comments.length}
        defaultOpen={false}
      >
        {comments.length === 0 ? (
          <RailEmpty>No comments</RailEmpty>
        ) : (
          comments.map((comment) => <CommentRow key={comment.id} comment={comment} />)
        )}
      </RailSection>
    </>
  );
}

function CommentRow({ comment }: { comment: PullRequestReviewComment }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-1.5">
      <div className="flex items-center gap-1.5">
        <ReviewerAvatar url={comment.authorAvatarUrl ?? null} login={comment.authorLogin} />
        <span className="shrink-0 text-tiny tracking-tiny text-text-muted">
          {comment.authorLogin}
        </span>
        {comment.path && (
          <RowActions>
            <span
              title={comment.path}
              className="flex min-w-0 items-center gap-1 truncate text-tiny tracking-tiny text-text-passive"
            >
              <FileText className="size-icon-xs shrink-0" />
              {comment.path}
              {comment.line != null && `:${comment.line}`}
            </span>
          </RowActions>
        )}
      </div>
      <p className="text-tiny tracking-tiny text-text-muted">{comment.body}</p>
    </div>
  );
}
