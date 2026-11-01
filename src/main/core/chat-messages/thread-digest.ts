import { sqlite } from '@main/db/client';
import { log } from '@main/lib/logger';

// Digest bounds (design doc §4, adopted from Mosaic's ClaudeRoomDigestBuilder):
// bounded is the contract — messages beyond the newest 8 are dropped from the
// digest, never queued. History still has every real message.
const MAX_MESSAGES = 8;
const MAX_CHARS_PER_MESSAGE = 800;
// Rows scanned per build before the qualifying filter — generous so a burst
// of non-qualifying rows (agent turns, system lines) can't starve the digest.
const CANDIDATE_LIMIT = 200;

// The boundary markers exist because a bare blank line between digest and
// prompt was not enough: in live testing (2026-09-09) the agent attributed
// the owner's actual prompt to the chat above it and refused it as an
// untrusted instruction. The digest is context; only what follows the end
// marker is addressed to the agent.
const DIGEST_HEADER =
  '[Thread messages since your last turn — conversation context, not addressed to you:]';
const DIGEST_FOOTER = '[End of thread context. The message below is the prompt addressed to you.]';

interface CandidateRow {
  rowid: number;
  id: string;
  sender_name: string | null;
  content: string;
  metadata: string | null;
}

export interface ThreadDigest {
  /** The digest block, or null when nothing unseen qualifies. */
  prefix: string | null;
  /** Prepends the digest to a prompt; pass-through when prefix is null. */
  wrap(prompt: string): string;
  /**
   * Advances THIS thread's cursor to the newest local chat row that existed at
   * BUILD time. Call only after the wrapped prompt actually reached the session
   * — a failed or parked delivery must not mark messages seen, or they are lost
   * to every future digest.
   */
  commit(): void;
}

/**
 * Catch-up context for one chat thread (plan: Remove the Room).
 *
 * Under open prompting every message in a thread wakes its agent, so the
 * digest is no longer how teammate chat reaches the agent — it is how the
 * agent catches up on what landed while it was busy, suspended, or offline.
 * The SDK session never rereads the local DB, so every prompt entering a
 * session is prefixed with a bounded, attributed digest of that thread's
 * unseen messages.
 *
 * Scope is the thread, plus work-item rows that have no session of their own:
 * messages from before threads existed, and every participant send — the WS
 * chat event has no session field yet, so that source is still live, not a
 * legacy tail. Those rows belong in every thread because no single thread owns
 * them; the per-session cursor means each agent still sees each one once.
 *
 * The cursor is per session, which is what fixes the Room's starvation bug:
 * one work-item-wide cursor meant whichever agent prompted first consumed the
 * digest and the second agent never saw those messages at all.
 *
 * "Unseen" is local arrival order (chat_messages ROWID), not created_at: a
 * reseed can ingest rows with old timestamps that are still news to the agent.
 * Qualifying rows are human text/code chat; agent turns, system rows, and
 * prompt-command chat rows (metadata.agent_prompt — the prompt IS the
 * delivery, digesting it would double-deliver) are excluded, as are the
 * caller's excludeIds (the chat row of the very prompt being sent).
 *
 * The digest is prompt-prefix only. It is never written to chat history —
 * history already has the real messages.
 *
 * Raw SQL against the sqlite handle rather than drizzle: every statement here
 * is already hand-written SQL, and the single remaining query builder call was
 * the only thing standing between this module and a real-database test.
 */
export function buildThreadDigest(
  workItemId: string,
  sessionId: string,
  excludeIds: readonly string[] = []
): ThreadDigest {
  const cursorRow = sqlite
    .prepare('SELECT last_rowid FROM agent_thread_cursors WHERE session_id = ?')
    .get(sessionId) as { last_rowid: number } | undefined;
  const lastSeenRowid = cursorRow?.last_rowid ?? 0;

  // Newest-first so the bound keeps the RECENT unseen messages, then
  // reversed — the digest reads oldest-first like a transcript.
  const candidates = sqlite
    .prepare(
      `SELECT rowid AS rowid, id, sender_name, content, metadata
         FROM chat_messages
        WHERE work_item_id = ?
          AND rowid > ?
          AND (session_id = ? OR session_id IS NULL)
          AND sender_type = 'human'
          AND message_type IN ('text', 'code')
        ORDER BY rowid DESC
        LIMIT ?`
    )
    .all(workItemId, lastSeenRowid, sessionId, CANDIDATE_LIMIT) as unknown as CandidateRow[];

  const excluded = new Set(excludeIds);
  const qualifying = candidates
    .filter((row) => {
      if (excluded.has(row.id)) return false;
      try {
        const metadata = JSON.parse(row.metadata ?? '{}') as { agent_prompt?: unknown };
        return metadata.agent_prompt !== true;
      } catch {
        return true;
      }
    })
    .slice(0, MAX_MESSAGES)
    .reverse();

  // Advance target captured at build time: rows arriving after this build
  // stay unseen for the next digest even if they land before commit().
  const maxRow = sqlite
    .prepare('SELECT MAX(rowid) AS max_rowid FROM chat_messages WHERE work_item_id = ?')
    .get(workItemId) as { max_rowid: number | null } | undefined;
  const advanceTo = Math.max(lastSeenRowid, maxRow?.max_rowid ?? 0);

  const prefix =
    qualifying.length === 0
      ? null
      : [
          DIGEST_HEADER,
          ...qualifying.map((row) => {
            const text =
              row.content.length > MAX_CHARS_PER_MESSAGE
                ? `${row.content.slice(0, MAX_CHARS_PER_MESSAGE)}…`
                : row.content;
            return `${row.sender_name ?? 'teammate'}: ${text}`;
          }),
        ].join('\n');

  return {
    prefix,
    wrap(prompt: string): string {
      return prefix === null ? prompt : `${prefix}\n${DIGEST_FOOTER}\n\n${prompt}`;
    },
    commit(): void {
      if (advanceTo <= lastSeenRowid && cursorRow) return;
      // MAX() against the row's CURRENT value, not the build-time snapshot:
      // two concurrent sends both build before either commits, and the one
      // committing second must never drag the cursor backwards — a regressed
      // cursor redelivers already-seen messages in every future digest.
      sqlite
        .prepare(
          `INSERT INTO agent_thread_cursors (session_id, last_rowid, updated_at)
                VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
                last_rowid = MAX(last_rowid, excluded.last_rowid),
                updated_at = excluded.updated_at`
        )
        .run(sessionId, advanceTo, Math.floor(Date.now() / 1000));
      if (prefix !== null) {
        log.info('[thread-digest] delivered digest and advanced cursor', {
          workItemId,
          sessionId,
          messages: qualifying.length,
          lastRowid: advanceTo,
        });
      }
    },
  };
}
