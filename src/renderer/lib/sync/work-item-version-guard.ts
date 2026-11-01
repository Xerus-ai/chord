import type { CloudWorkItem } from '@renderer/lib/cloud-api';

/**
 * Singleton version guard for cloud work items. `work_items.version_number`
 * is server-assigned and monotonic; every REST seed and every
 * `work_item_updated` broadcast passes through this module so a stale
 * in-flight seed can never regress state a newer broadcast already applied —
 * and so every consumer (sidebar list cache, work-item view cache) agrees on
 * the highest version seen. Module-level state, not a hook: reads inside WS
 * handlers must be stable and version bumps must not re-render anything.
 */

export interface WorkItemUpdatedPayload {
  work_item_id: string;
  changes: Partial<CloudWorkItem>;
  version_number: number;
  updated_by: string;
  updated_at: string;
}

const versions = new Map<string, number>();

/**
 * Records `version` if it is not older than the highest seen and reports
 * whether the caller should apply the data it came with. Equal versions pass:
 * one broadcast dispatch fans out to several subscribers (sidebar AND view),
 * each maintaining its own query cache, and re-applying the same update is
 * idempotent. Only strictly older data is dropped.
 */
export function commitIfNewer(workItemId: string, version: number): boolean {
  const seen = versions.get(workItemId) ?? 0;
  if (version < seen) return false;
  versions.set(workItemId, version);
  return true;
}

/** Drops tracking for one item (deleted / access revoked). */
export function forgetWorkItemVersion(workItemId: string): void {
  versions.delete(workItemId);
}

/** Drops all tracking. Called on sign-out — versions are per-account state. */
export function forgetAllWorkItemVersions(): void {
  versions.clear();
}

/**
 * The one shared application of a `work_item_updated` broadcast to a cached
 * row. Kept beside the guard so the compare and the apply can never diverge
 * between consumers.
 */
export function applyWorkItemUpdate(
  item: CloudWorkItem,
  payload: WorkItemUpdatedPayload
): CloudWorkItem {
  return {
    ...item,
    ...payload.changes,
    version_number: payload.version_number,
    updated_at: payload.updated_at,
  };
}
