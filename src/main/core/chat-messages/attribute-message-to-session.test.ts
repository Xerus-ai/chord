/**
 * A message saved before any chat session existed — a work item's first
 * prompt, or one held until setup succeeds — is stored with no session and
 * reads as room chat: every chat of the item showed it, and the rail counted
 * it against none ("0 msgs", devstation-w50w). Delivery ties it to the
 * session it reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Real SQLite from the shipped migrations, as in session-row-summaries.test.ts. */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, chatMessages, repos, workItems } = await import(
  '@main/db/schema-work-items'
);
const { attributeMessageToSession } = await import('./attribute-message-to-session');
const { readSessionRowSummaries } = await import('@main/core/agent-sessions/session-row-summaries');

const WORK_ITEM_ID = 'w-1';

async function addMessage(id: string, sessionId: string | null): Promise<void> {
  await db.insert(chatMessages).values({
    id,
    workItemId: WORK_ITEM_ID,
    sessionId,
    senderType: 'human',
    content: 'Reply with only the word READY.',
    messageType: 'text',
    createdAt: 1,
    createdAtMs: 1000,
  });
}

function countFor(sessionId: string): number | undefined {
  return readSessionRowSummaries(WORK_ITEM_ID).find((row) => row.sessionId === sessionId)
    ?.messageCount;
}

beforeEach(async () => {
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db
    .insert(workItems)
    .values({ id: WORK_ITEM_ID, repoId: 'r-1', repoPath: '/tmp/chord', name: 'Setup' });
  await db.insert(agentSessions).values([
    { id: 's-1', workItemId: WORK_ITEM_ID, kind: 'chat', status: 'active' },
    { id: 's-2', workItemId: WORK_ITEM_ID, kind: 'chat', status: 'active' },
  ]);
});

describe('attributeMessageToSession', () => {
  it('ties a message saved with no session to the session it was delivered to', async () => {
    await addMessage('m-held', null);

    await attributeMessageToSession('m-held', 's-1');

    expect(countFor('s-1')).toBe(1);
    expect(countFor('s-2')).toBe(0);
  });

  it('never moves a message that already belongs to a session', async () => {
    await addMessage('m-own', 's-2');

    await attributeMessageToSession('m-own', 's-1');

    expect(countFor('s-1')).toBe(0);
    expect(countFor('s-2')).toBe(1);
  });

  it('throws for a message that does not exist', async () => {
    await expect(attributeMessageToSession('m-missing', 's-1')).rejects.toThrow(/m-missing/);
  });
});
