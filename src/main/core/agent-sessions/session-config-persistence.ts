import { eq, inArray, like } from 'drizzle-orm';
import { db } from '@main/db/client';
import { kv } from '@main/db/schema';
import { agentSessions } from '@main/db/schema-work-items';
import type { ChatSessionConfig } from './session-config-store';

/**
 * Durable copy of `session-config-store`, one `kv` row per session keyed
 * `session-config:<sessionId>` (same `namespace:key` layout as `db/kv.ts`).
 * Synchronous — unlike the `KV` class — because launch config is resolved
 * synchronously on the session start path.
 */

const PREFIX = 'session-config:';

/**
 * Every stored override whose session can still run. Rows for sessions that
 * are gone or retired to `done` (by whichever path retired them) are deleted
 * here, so overrides never accumulate past their session.
 */
export function loadSessionConfigs(): Map<string, ChatSessionConfig> {
  const rows = db
    .select({ key: kv.key, value: kv.value })
    .from(kv)
    .where(like(kv.key, `${PREFIX}%`))
    .all();
  const sessionIds = rows.map((row) => row.key.slice(PREFIX.length));
  const statusBySession = new Map(
    sessionIds.length === 0
      ? []
      : db
          .select({ id: agentSessions.id, status: agentSessions.status })
          .from(agentSessions)
          .where(inArray(agentSessions.id, sessionIds))
          .all()
          .map((session) => [session.id, session.status])
  );
  const configs = new Map<string, ChatSessionConfig>();
  for (const [index, row] of rows.entries()) {
    const sessionId = sessionIds[index];
    const status = statusBySession.get(sessionId);
    if (status === undefined || status === 'done') {
      deleteSessionConfig(sessionId);
      continue;
    }
    configs.set(sessionId, JSON.parse(row.value) as ChatSessionConfig);
  }
  return configs;
}

export function saveSessionConfig(sessionId: string, config: ChatSessionConfig): void {
  const value = JSON.stringify(config);
  const now = Date.now();
  db.insert(kv)
    .values({ key: PREFIX + sessionId, value, updatedAt: now })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: now } })
    .run();
}

export function deleteSessionConfig(sessionId: string): void {
  db.delete(kv)
    .where(eq(kv.key, PREFIX + sessionId))
    .run();
}
