import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A message the owner addresses only to people is chat, not a prompt: it is
 * saved in its thread and synced, and the agent reads it in the thread digest
 * on its next turn. It no longer wakes the agent, which then had to answer
 * "Not addressed to me — no action." to every one (user report, 2026-10-02;
 * the teammate's composer already worked this way). Real SQLite from the
 * shipped migrations and the real signed-in account (see migrated-test-db.ts).
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { agentSessions, chatMessages, repos, workItems } = await import(
  '@main/db/schema-work-items'
);
const { syncQueue } = await import('@main/db/schema-sync');
const { postMessageToThread } = await import('./post-to-thread');

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  for (const id of ['w-1', 'w-2']) {
    await db.insert(workItems).values({ id, repoId: 'r-1', repoPath: '/tmp/chord', name: id });
  }
  for (const [id, workItemId] of [
    ['s-1', 'w-1'],
    ['s-other', 'w-2'],
  ]) {
    await db.insert(agentSessions).values({
      id,
      workItemId,
      kind: 'chat',
      agentProviderId: 'claude',
      communication: 'acp',
      status: 'running',
    });
  }
});

describe('postMessageToThread', () => {
  it('saves a message addressed to people in its thread, as the sender’s, and syncs it', async () => {
    const result = await postMessageToThread({
      workItemId: 'w-1',
      sessionId: 's-1',
      content: '@Hey Headth can you review the card?',
    });
    if (!result.success) throw new Error(JSON.stringify(result.error));

    const [row] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, result.data.messageId));
    expect(row).toMatchObject({
      workItemId: 'w-1',
      sessionId: 's-1',
      senderType: 'human',
      senderName: 'ada',
      content: '@Hey Headth can you review the card?',
    });
    const queued = db.select().from(syncQueue).all();
    expect(queued.some((op) => JSON.stringify(op).includes(result.data.messageId))).toBe(true);
  });

  it('refuses a thread of another work item and stores nothing', async () => {
    const before = db.select().from(chatMessages).all().length;
    const result = await postMessageToThread({
      workItemId: 'w-1',
      sessionId: 's-other',
      content: '@Hey Headth misaddressed',
    });
    expect(result.success).toBe(false);
    expect(db.select().from(chatMessages).all()).toHaveLength(before);
  });
});
