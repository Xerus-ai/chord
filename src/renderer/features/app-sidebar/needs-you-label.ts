import type { NeedsYouReason } from '@shared/sidebar-summaries';

function reasonLabel(reason: NeedsYouReason): string {
  switch (reason.kind) {
    case 'pending_permission':
      return reason.count > 1 ? `${reason.count} permission requests` : 'Needs permission';
    case 'pending_plan':
      return 'Plan to approve';
    case 'review_requested':
      return 'Review requested';
    case 'changes_requested':
      return 'Address review';
    case 'mentioned':
      return reason.count > 1 ? `Mentioned you ${reason.count}×` : 'Mentioned you';
  }
}

/**
 * The sidebar subline for a work item waiting on the user: the most urgent
 * reason (ordered permission, plan, review, changes, mention), plus
 * how many more there are. Null when nothing needs the user.
 */
export function needsYouLabel(reasons: readonly NeedsYouReason[]): string | null {
  const [first, ...rest] = reasons;
  if (!first) return null;
  return rest.length > 0 ? `${reasonLabel(first)} +${rest.length}` : reasonLabel(first);
}
