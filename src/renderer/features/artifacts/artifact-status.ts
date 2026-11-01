import type { StatusSignal } from '@renderer/lib/status-dot';

const BADGES: Record<string, { label: string; signal: StatusSignal }> = {
  draft: { label: 'Draft', signal: 'neutral' },
  in_review: { label: 'In review', signal: 'warning' },
  approved: { label: 'Approved', signal: 'success' },
  built: { label: 'Built', signal: 'success' },
};

/**
 * An artifact's status as its file bar shows it (shared-items step 4,
 * decision 1). No status, no badge; a status this build does not know is an
 * error rather than a raw word on screen.
 */
export function artifactStatusBadge(
  status: string | null
): { label: string; signal: StatusSignal } | null {
  if (status === null) return null;
  const badge = BADGES[status];
  if (!badge) throw new Error(`Unknown artifact status "${status}"`);
  return badge;
}
