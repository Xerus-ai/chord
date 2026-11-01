const STORAGE_KEY = 'chord:notifications:read:v1';

/** Read state is only useful for notifications recent enough to still be
    delivered; keeping every id ever seen would grow without bound. */
const MAX_TRACKED = 200;

export interface ReadIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadReadNotificationIds(storage: ReadIdStorage): Set<string> {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return new Set();

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Corrupt ${STORAGE_KEY}: expected an array of notification ids`);
  }
  return new Set(parsed.filter((id): id is string => typeof id === 'string'));
}

/**
 * Records `ids` as read and returns the resulting set. Newest ids win when the
 * list is trimmed, so a burst of notifications cannot evict itself.
 */
export function saveReadNotificationIds(
  storage: ReadIdStorage,
  known: Set<string>,
  ids: string[]
): Set<string> {
  const merged = [...known, ...ids];
  const deduped = [...new Set(merged)];
  const trimmed = deduped.slice(Math.max(0, deduped.length - MAX_TRACKED));
  storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return new Set(trimmed);
}
