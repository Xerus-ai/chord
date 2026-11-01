import type { ChatEntry } from './chat-types';

/**
 * Appends `incoming` to `base`, dropping every entry whose id is already
 * present (in `base` or earlier in `incoming`).
 *
 * The initial history load and the live listeners race: rows inserted between
 * the SELECT and its promise resolving are delivered as events first, so a
 * wholesale `setMessages(seed)` would throw them away. Merging by id keeps
 * both halves, and re-delivery of a row already held is a no-op.
 */
export function mergeChatEntries(base: readonly ChatEntry[], incoming: readonly ChatEntry[]) {
  if (incoming.length === 0) return base as ChatEntry[];
  const seen = new Set(base.map((e) => e.id));
  const additions: ChatEntry[] = [];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    additions.push(entry);
  }
  if (additions.length === 0) return base as ChatEntry[];
  return [...base, ...additions];
}

/**
 * Chronological order, to the millisecond: two rows of one second keep the
 * order they were written in (devstation-vihv). System events carry their own
 * time — treating them as timestamp 0 used to sort every commit event to the
 * top of the chat, above messages that predate it.
 */
export function compareChatEntries(a: ChatEntry, b: ChatEntry): number {
  return a.createdAtMs - b.createdAtMs;
}
