/**
 * Short-TTL cache in front of the access resolver. Access is checked on every
 * REST route, WS write event and Yjs connect, so a burst (chat, typing) would
 * otherwise pay one DB round trip per event. Every entry is tagged with the
 * work item it belongs to — artifact entries included — so one
 * invalidateWorkItemAccess call drops everything a sharing change can affect.
 * Every route that changes access calls it; the TTL only bounds the staleness
 * of anything that somehow does not.
 */

const ACCESS_CACHE_TTL_MS = 20_000;
const ACCESS_CACHE_SWEEP_INTERVAL_MS = 30_000;

export type AccessCacheKind = 'work_item' | 'artifact';

interface CacheEntry {
  workItemId: string;
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, CacheEntry>();

function cacheKey(kind: AccessCacheKind, resourceId: string, userId: string): string {
  return `${kind}:${resourceId}:${userId}`;
}

export function readCachedAccess<T>(
  kind: AccessCacheKind,
  resourceId: string,
  userId: string
): T | undefined {
  const key = cacheKey(kind, resourceId, userId);
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function writeCachedAccess(
  kind: AccessCacheKind,
  resourceId: string,
  userId: string,
  workItemId: string,
  value: unknown
): void {
  entries.set(cacheKey(kind, resourceId, userId), {
    workItemId,
    value,
    expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
  });
}

/** Drops every cached answer for the work item and each of its artifacts. */
export function invalidateWorkItemAccess(workItemId: string): void {
  for (const [key, entry] of entries) {
    if (entry.workItemId === workItemId) entries.delete(key);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}, ACCESS_CACHE_SWEEP_INTERVAL_MS).unref();
