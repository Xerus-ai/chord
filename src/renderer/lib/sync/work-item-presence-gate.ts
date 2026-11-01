/**
 * Backoff for presence polling on work items the cloud does not have yet.
 *
 * A work item that has not reached the cloud has no presence endpoint: GET
 * /presence/:work_item_id answers 404. Every presence refresh trigger —
 * mount, socket reconnect, each presence_changed for an unknown user — hits
 * it again straight away, so a purely local work item (or one whose
 * sync-queue push is still lagging behind a token refresh) produces an
 * unbounded `404 Work item not found` log loop.
 *
 * Parking a work item after a 404 backs the next attempt off exponentially.
 * Joining the work item's WS room proves the cloud row exists, so the sync
 * socket provider clears the park the moment that happens rather than making
 * presence sit out the rest of its delay.
 */
const FIRST_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60 * 1_000;

interface ParkedWorkItem {
  retryAt: number;
  misses: number;
}

const parkedWorkItems = new Map<string, ParkedWorkItem>();

/** False while the work item is parked — skip the fetch and log nothing. */
export function shouldFetchWorkItemPresence(workItemId: string): boolean {
  const parked = parkedWorkItems.get(workItemId);
  return !parked || Date.now() >= parked.retryAt;
}

/** Records that the cloud has no row for this work item yet. */
export function parkWorkItemPresence(workItemId: string): void {
  const misses = (parkedWorkItems.get(workItemId)?.misses ?? 0) + 1;
  const delay = Math.min(FIRST_BACKOFF_MS * 2 ** (misses - 1), MAX_BACKOFF_MS);
  parkedWorkItems.set(workItemId, { misses, retryAt: Date.now() + delay });
}

/** Called once the cloud row is known to exist — a fetch that returned rows,
 * or a granted join of the work item's room. */
export function clearWorkItemPresenceGate(workItemId: string): void {
  parkedWorkItems.delete(workItemId);
}
