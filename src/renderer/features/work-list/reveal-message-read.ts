import type { CloudChatMessage } from '@chord/protocol';
import { CloudApiError } from '@renderer/lib/cloud-fetch';

/** What a reveal needs to know about its message. */
export interface RevealMessageRow {
  id: string;
  /** The chat it was written in; null for the item's history (shown in every chat). */
  sessionId: string | null;
  /** ISO-8601, the server's: where a feed must page back to. */
  createdAt: string;
  /** The cloud row itself, when it was read from the cloud: a thread missing it can add it. */
  cloudRow?: CloudChatMessage;
}

export type RevealReadOutcome =
  | { kind: 'found'; message: RevealMessageRow }
  /** Not in this work item (never synced, or removed with what held it). */
  | { kind: 'gone' }
  /** In a chat this viewer cannot see: an artifact-only share. */
  | { kind: 'hidden' }
  | { kind: 'failed'; message: string };

/** The cloud read's answer when it threw (shared-items step 5, decision 4). */
export function revealReadOutcomeOf(error: unknown): Exclude<RevealReadOutcome, { kind: 'found' }> {
  if (error instanceof CloudApiError && error.status === 404) return { kind: 'gone' };
  if (error instanceof CloudApiError && error.status === 403) return { kind: 'hidden' };
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

/**
 * The owner's own row reaches the cloud by the sync push, a moment after the
 * mention that names it: a cloud 404 is asked again after each of these waits
 * before it counts as gone (three tries over 4 s).
 */
const CLOUD_404_WAITS_MS = [1_500, 2_500];

/**
 * Reads a revealed message (decision 1): the owner's local copy first
 * (teammate rows are ingested locally, so it is usually there), then the
 * cloud, which also answers "not there" and "not yours". `readLocal` is null
 * for a teammate, who has no local copy.
 */
export async function readRevealMessage({
  readLocal,
  readCloud,
  wait,
}: {
  readLocal: (() => Promise<RevealMessageRow | null>) | null;
  readCloud: () => Promise<RevealMessageRow>;
  wait: (ms: number) => Promise<void>;
}): Promise<RevealReadOutcome> {
  if (readLocal) {
    try {
      const local = await readLocal();
      if (local) return { kind: 'found', message: local };
    } catch (error) {
      return revealReadOutcomeOf(error);
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return { kind: 'found', message: await readCloud() };
    } catch (error) {
      const outcome = revealReadOutcomeOf(error);
      const delay = CLOUD_404_WAITS_MS[attempt];
      if (outcome.kind !== 'gone' || delay === undefined) return outcome;
      await wait(delay);
    }
  }
}

/** The reveal's view of a cloud row. */
export function revealRowOfCloud(row: CloudChatMessage): RevealMessageRow {
  return { id: row.id, sessionId: row.session_id, createdAt: row.created_at, cloudRow: row };
}
