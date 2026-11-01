import type { TranscriptItem } from './transcript-rows';

/**
 * Where a revealed message sits in a transcript (shared-items step 5): its
 * message row, -1 while it is not loaded. Notified messages are people's, so
 * they are message rows; an agent turn is never the target.
 */
export function findRevealIndex(items: readonly TranscriptItem[], messageId: string): number {
  return items.findIndex((item) => item.type === 'message' && item.entry.id === messageId);
}
