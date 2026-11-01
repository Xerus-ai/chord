import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { agentSessions } from './schema-work-items';

/**
 * Agent-side conversation ids a chat held before its current one: Reset to
 * here rebinds a chat to a fork, and the conversation it left stays on disk.
 * It is still that chat's, so session import must not offer it as one found
 * on this machine (session-import/owned-sessions.ts). Local only: it names
 * files on this machine, so it is never published to the cloud.
 */
export const agentSessionSupersededIds = sqliteTable(
  'agent_session_superseded_ids',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSessions.id, { onDelete: 'cascade' }),
    externalSessionId: text('external_session_id').notNull(),
    supersededAt: integer('superseded_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.externalSessionId] }),
    externalSessionIdIdx: index('idx_agent_session_superseded_ids_external_session_id').on(
      table.externalSessionId
    ),
  })
);
