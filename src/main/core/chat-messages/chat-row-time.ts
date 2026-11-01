/**
 * When a chat row was written, in both of `chat_messages`' units: epoch
 * seconds (`created_at`, what everything else reads) and the same moment to
 * the millisecond (`created_at_ms`, what a chat is ordered by, so a prompt
 * sent the second its previous turn finished still shows after it;
 * devstation-vihv).
 */
export interface ChatRowTime {
  createdAt: number;
  createdAtMs: number;
}

/** The row time of `ms` (now, unless the moment is known, e.g. an imported message). */
export function stampChatRowTime(ms: number = Date.now()): ChatRowTime {
  return { createdAt: Math.floor(ms / 1000), createdAtMs: ms };
}

/**
 * A stored row's milliseconds. Every writer sets them and the migration gave
 * older rows theirs, so a row without them was written by a path that skipped
 * the column: a bug to surface, not a row to order by guesswork.
 */
export function requireCreatedAtMs(row: { id: string; createdAtMs: number | null }): number {
  if (row.createdAtMs === null) {
    throw new Error(`chat_messages row ${row.id} has no created_at_ms`);
  }
  return row.createdAtMs;
}
