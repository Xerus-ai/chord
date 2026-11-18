// A pending backlog is only surfaced once the drain has made no progress for
// this long (or has never run) — ordinary retry backoff must not flash a
// banner, but a wedged queue (NEW-6 sat silent for 20 days) must show.
export const STALE_DRAIN_SECONDS = 15 * 60;

export interface SyncBacklogHealth {
  pendingCount: number;
  lastSuccessfulDrainAt: number | null;
  orgUnresolved: boolean;
  resumedAt: number | null;
}

/** Why queued operations are not going out, or null when nothing needs saying. */
export type SyncBacklog = 'org-unresolved' | 'stalled' | null;

/**
 * Staleness counts from the later of the last drain and the last resume after
 * a version pause, so the time spent paused (when the update screen replaces
 * the app, badge included) is never read as a stalled drain once traffic
 * reopens.
 */
export function syncBacklog(health: SyncBacklogHealth, nowSeconds: number): SyncBacklog {
  if (health.pendingCount === 0) return null;
  const progressAt = Math.max(health.lastSuccessfulDrainAt ?? 0, health.resumedAt ?? 0);
  const neverRan = health.lastSuccessfulDrainAt === null && health.resumedAt === null;
  if (!neverRan && nowSeconds - progressAt < STALE_DRAIN_SECONDS) return null;
  return health.orgUnresolved ? 'org-unresolved' : 'stalled';
}
