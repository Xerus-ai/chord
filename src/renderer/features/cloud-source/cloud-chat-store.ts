import type { CloudChatMessage } from '@chord/protocol';

/**
 * Pure sorted-array store for cloud chat messages, extracted out of
 * use-cloud-chat.ts. `order` is kept sorted (created_at, id) at all times
 * via upsertOne, so consumers never sort or rebuild it — the exported
 * `messages` array in the hook is just this field directly.
 */
export interface CloudChatState {
  workItemId: string;
  order: CloudChatMessage[];
  byId: Map<string, CloudChatMessage>;
  seeded: boolean;
  hasOlder: boolean;
}

export function cursorOf(message: CloudChatMessage): string {
  return `${message.created_at},${message.id}`;
}

/**
 * Newest row whose created_at came from the SERVER, scanning back past any
 * optimistic rows this window appended (`unconfirmedIds`).
 *
 * An optimistic row is stamped with `new Date()` on this machine, and the
 * reconnect reseed asks the server for everything `?after=` that cursor. On a
 * machine whose clock runs fast, an un-acked row's timestamp sits in the
 * server's future — every message the outage actually dropped would fall
 * BEFORE the cursor and be skipped, permanently. Only a value the server
 * itself produced (a seed/broadcast row, or an optimistic row whose ack has
 * since rewritten created_at) can be compared against server timestamps.
 */
export function lastServerConfirmed(
  order: readonly CloudChatMessage[],
  unconfirmedIds: ReadonlySet<string>
): CloudChatMessage | undefined {
  for (let i = order.length - 1; i >= 0; i--) {
    const row = order[i];
    if (row && !unconfirmedIds.has(row.id)) return row;
  }
  return undefined;
}

export function compareMessages(a: CloudChatMessage, b: CloudChatMessage): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Whether the feed holds rows back to `target` (shared-items step 5): its
 * oldest loaded row is at or before it, in the server's (created_at, id) order.
 */
export function reachesBack(
  order: readonly CloudChatMessage[],
  target: Pick<CloudChatMessage, 'created_at' | 'id'>
): boolean {
  const oldest = order[0];
  if (!oldest) return false;
  if (oldest.created_at !== target.created_at) return oldest.created_at < target.created_at;
  return oldest.id <= target.id;
}

// Leftmost index in a compareMessages-sorted array where `msg` belongs. Ids
// are unique, so searching with a message already IN the array (its old
// self, before an update) lands exactly on that element — the id tiebreak
// disambiguates same-millisecond rows without a linear scan.
function lowerBound(order: CloudChatMessage[], msg: CloudChatMessage): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareMessages(order[mid]!, msg) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function indexOfExisting(order: CloudChatMessage[], existing: CloudChatMessage): number {
  const idx = lowerBound(order, existing);
  return idx < order.length && order[idx]!.id === existing.id ? idx : -1;
}

/**
 * Inserts or updates one message in a sorted (order, byId) pair, mutating
 * both — callers own a fresh working copy for the whole batch (see
 * applyBatch), so this isn't a fresh allocation per message. Messages arrive
 * mostly in chronological order, so the common case — a new message sorting
 * after everything currently held — is an O(1) push. Only genuinely
 * out-of-order arrivals (an older REST page merged behind live events, an
 * ack moving a row's created_at) pay the O(log n) search + splice.
 */
function upsertOne(
  order: CloudChatMessage[],
  byId: Map<string, CloudChatMessage>,
  msg: CloudChatMessage
): void {
  const existing = byId.get(msg.id);
  if (existing) {
    if (existing.created_at === msg.created_at) {
      // Sort position unchanged (e.g. hydrateMessage filling in metadata
      // for the same row) — replace content in place.
      const idx = indexOfExisting(order, existing);
      if (idx >= 0) order[idx] = msg;
      byId.set(msg.id, msg);
      return;
    }
    // The ack reconciling an optimistic created_at moves the row — drop the
    // old slot and fall through to a fresh insert at the new position.
    const oldIdx = indexOfExisting(order, existing);
    if (oldIdx >= 0) order.splice(oldIdx, 1);
  }
  const last = order[order.length - 1];
  const insertIdx =
    !last || compareMessages(last, msg) <= 0 ? order.length : lowerBound(order, msg);
  order.splice(insertIdx, 0, msg);
  byId.set(msg.id, msg);
}

export function emptyState(workItemId: string): CloudChatState {
  return { workItemId, order: [], byId: new Map(), seeded: false, hasOlder: false };
}

// Applies a batch against `state` in one working copy — one order/byId
// allocation for the whole batch, not one per message. Returns the input
// `state` unchanged (same reference) when nothing in the batch actually
// applies, so a no-op merge never triggers a re-render.
export function applyBatch(
  state: CloudChatState | null,
  workItemId: string,
  incoming: CloudChatMessage[]
): CloudChatState | null {
  if (incoming.length === 0) return state;
  const base = state && state.workItemId === workItemId ? state : emptyState(workItemId);
  const order = base.order.slice();
  const byId = new Map(base.byId);
  let changed = false;
  for (const message of incoming) {
    if (message.work_item_id !== workItemId) continue;
    upsertOne(order, byId, message);
    changed = true;
  }
  return changed ? { ...base, order, byId } : state;
}
