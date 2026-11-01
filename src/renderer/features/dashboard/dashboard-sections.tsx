import { AlertTriangle, CheckCircle, GitMerge, GitPullRequest } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NeedsYouPullRequestRef } from '@shared/sidebar-summaries';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { ListRow } from '@renderer/lib/components/list-row';
import { rpc } from '@renderer/lib/ipc';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

/** A dashboard section: the rail's small-caps label, its count, its rows. */
export function DashboardSection({
  label,
  count,
  layout = 'list',
  children,
}: {
  label: string;
  count?: number;
  /** 'grid' puts two cards per row once the column is wide enough for the
   * facts line (a container query, so it tracks the column, not the window). */
  layout?: 'list' | 'grid';
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-1.5 flex h-6 items-center gap-1.5">
        <span className="section-header">{label}</span>
        {count !== undefined && (
          <span className="section-header tabular-nums font-medium">{count}</span>
        )}
      </div>
      <div
        className={
          layout === 'grid' ? 'grid grid-cols-1 gap-2 @2xl:grid-cols-2' : 'flex flex-col gap-1.5'
        }
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A PR someone asked the user to review that is not one of their own work
 * items — there is no card to hang it on, so it is one dashed line that opens
 * the PR on GitHub.
 */
export function ReviewRequestRow({ pullRequest }: { pullRequest: NeedsYouPullRequestRef }) {
  return (
    <button
      type="button"
      onClick={() => void rpc.app.openExternal(pullRequest.url)}
      className="flex h-9 items-center gap-2.5 rounded-lg border border-dashed border-border px-3 text-left transition-colors hover:bg-surface-hover"
    >
      <GitPullRequest className="size-icon-sm shrink-0 text-status-ok" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-body tracking-body text-text-muted">
        <span className="font-mono text-text-passive">#{pullRequest.number}</span>{' '}
        {pullRequest.title}
      </span>
      <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
        {pullRequest.repo}
        {pullRequest.author && ` · ${pullRequest.author}`} · review requested
      </span>
    </button>
  );
}

/**
 * The dashboard's error line: one bordered row with the reason and a retry,
 * sized like the content around it. A failure here costs one section, so it
 * reads as a note on that section rather than as a page-level alarm.
 */
export function InlineNotice({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-8 items-start gap-2 rounded-lg border border-border px-3 py-1.5 text-tiny tracking-tiny text-text-passive">
      <AlertTriangle className="mt-0.5 size-icon-xs shrink-0 text-status-warn" />
      <span className="min-w-0 flex-1 break-words">
        <span className="text-text-muted">{title}</span>
        {message && ` — ${message}`}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-medium text-text-muted hover:text-text"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** GitHub's review search failed: local reasons still show, and this says
 * which ones are missing rather than implying there are none. */
export function ReviewRequestsError({ onRetry }: { onRetry: () => void }) {
  return (
    <InlineNotice
      title="Couldn't check GitHub for review requests"
      message="showing local reasons only."
      onRetry={onRetry}
    />
  );
}

export function CompletedItem({ item, onClick }: { item: WorkItemRow; onClick: () => void }) {
  // A completed item is a scanned row, so it wears the shared list row rather
  // than a divider list of its own — the same treatment the sidebar and rail
  // give a row.
  return (
    <ListRow
      onOpen={onClick}
      leading={
        item.prNumber ? (
          <GitMerge className="size-icon-sm shrink-0 text-status-merged" />
        ) : (
          <CheckCircle className="size-icon-sm shrink-0 text-status-ok" />
        )
      }
      title={item.name}
      trailing={
        <span className="flex shrink-0 items-center gap-2 text-tiny tracking-tiny text-text-passive">
          {item.prNumber && <span className="font-mono">#{item.prNumber}</span>}
          <RelativeTime value={item.updatedAt * 1000} compact />
        </span>
      }
    />
  );
}

export function CardSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-[86px] animate-pulse rounded-lg bg-surface-hover" />
      ))}
    </>
  );
}

export function NoWorkItemsState() {
  return (
    <div className="py-4 text-body tracking-body text-text-passive">
      <p className="font-medium text-text-muted">No work items yet</p>
      <p className="mt-0.5">
        Describe what you want to build above — the agent sets up a branch and gets started.
      </p>
    </div>
  );
}
