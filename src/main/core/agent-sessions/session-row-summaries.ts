import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';

/** What a session row in the Work item map shows beyond its own columns. */
export interface SessionRowSummary {
  sessionId: string;
  /** Every message attributed to this session, agent turns included. */
  messageCount: number;
  /** The most recent message with text, or null when nothing has been said. */
  preview: string | null;
}

/**
 * Message count and preview line for every session of one work item.
 *
 * ONE statement for all of them. The obvious shape — ask per row while
 * rendering — is an N+1 against a table that grows with every turn, on a panel
 * that repolls every five seconds.
 *
 * It is driven from `agent_sessions`, not from `chat_messages`, so a session
 * that has said nothing still gets a row: `0` is a fact about a quiet session,
 * and a missing entry would make the renderer guess. The LEFT JOIN is also
 * what keeps teammates out — `chat_messages.session_id` is provenance, not a
 * foreign key (schema-work-items.ts:157-166), and cloud ingest writes the
 * originating device's session id, which matches no local row. Those messages
 * belong to no session here and are counted against none.
 *
 * The preview deliberately skips empty content: an agent turn keeps its items
 * in `metadata` and stores `content` as '' (persist-agent-turn.ts), so taking
 * the plain latest row would blank the line on every session an agent last
 * touched — which is most of them. The turn still counts; it just cannot be
 * the line.
 */
export function readSessionRowSummaries(workItemId: string): SessionRowSummary[] {
  const rows = db
    .select({
      sessionId: agentSessions.id,
      // The outer reference is written out rather than interpolated: drizzle
      // renders a column placeholder unqualified ("id"), which inside these
      // subqueries binds to chat_messages' OWN id — `m.session_id = m.id` is
      // false for every row, so both values came back empty with no error.
      messageCount: sql<number>`(
        SELECT COUNT(*) FROM chat_messages m
        WHERE m.session_id = agent_sessions.id
      )`,
      preview: sql<string | null>`(
        SELECT m.content FROM chat_messages m
        WHERE m.session_id = agent_sessions.id AND m.content <> ''
        ORDER BY m.created_at_ms DESC, m.id DESC
        LIMIT 1
      )`,
    })
    .from(agentSessions)
    .where(eq(agentSessions.workItemId, workItemId))
    .all();

  return rows.map((row) => ({
    sessionId: row.sessionId,
    messageCount: Number(row.messageCount),
    preview: row.preview ?? null,
  }));
}
