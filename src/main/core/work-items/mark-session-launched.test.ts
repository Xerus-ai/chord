import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A session that has just launched is active, whatever carries it
 * (devstation-ioly): Reset restarts a chat that stopSession had suspended,
 * and a Codex or ACP chat started that way kept reading "suspended" in the
 * rail while it ran, because only the Claude and PTY launch paths wrote the
 * status. Real migrated database.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, repos, workItems } = await import('@main/db/schema-work-items');
const { markSessionLaunched } = await import('./mark-session-launched');

const SESSION_ID = 'session-launched';

function readSession() {
  const [row] = db.select().from(agentSessions).where(eq(agentSessions.id, SESSION_ID)).all();
  return row;
}

beforeEach(async () => {
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'repo-l', alias: 'l', path: 'D:/nowhere/l' });
  await db
    .insert(workItems)
    .values({ id: 'wi-l', repoId: 'repo-l', repoPath: 'D:/nowhere/l', name: 'L' });
  await db.insert(agentSessions).values({
    id: SESSION_ID,
    workItemId: 'wi-l',
    kind: 'chat',
    agentProviderId: 'codex',
    status: 'suspended',
    provisionStatus: 'pending',
    lastActiveAt: 1,
  });
});

describe('markSessionLaunched', () => {
  it.each(['codex-app-server', 'acp', 'claude-sdk', 'pty'] as const)(
    'records a suspended session launched over %s as active and running',
    (transport) => {
      markSessionLaunched(SESSION_ID, transport);

      const row = readSession();
      expect(row.status).toBe('active');
      expect(row.provisionStatus).toBe('running');
      expect(row.lastActiveAt).toBeGreaterThan(1);
    }
  );

  it('stores the agent transports as acp and a PTY as pty', () => {
    markSessionLaunched(SESSION_ID, 'codex-app-server');
    expect(readSession().communication).toBe('acp');
    markSessionLaunched(SESSION_ID, 'pty');
    expect(readSession().communication).toBe('pty');
  });
});
