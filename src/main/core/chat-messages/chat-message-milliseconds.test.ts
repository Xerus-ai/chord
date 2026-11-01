import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every chat row records when it was written to the millisecond
 * (devstation-vihv): a chat is ordered by it, and a prompt sent in the same
 * second the previous turn finished must still show after that turn. Each
 * write path is exercised for real against a migrated database.
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
const { chatMessages, repos, workItems } = await import('@main/db/schema-work-items');
const { persistCompletedTurn } = await import('./persist-agent-turn');
const { insertChatMessageRow } = await import('./insert-chat-message-row');
const { ingestCloudChatMessage } = await import('./chat-ingestion');
const { toCloudChatBulkMessage } = await import('./chat-wire-mapper');
const { recordHistoryReset } = await import('@main/core/chat-history/record-history-reset');

const WORK_ITEM_ID = 'wi-ms';

function readRow(id: string) {
  const [row] = db.select().from(chatMessages).where(eq(chatMessages.id, id)).all();
  return row;
}

/** Asserts the row was stamped between `before` and `after`, in step with its seconds. */
function expectStampedBetween(id: string, before: number, after: number) {
  const row = readRow(id);
  expect(row.createdAtMs).not.toBeNull();
  expect(row.createdAtMs as number).toBeGreaterThanOrEqual(before);
  expect(row.createdAtMs as number).toBeLessThanOrEqual(after);
  expect(row.createdAt).toBe(Math.floor((row.createdAtMs as number) / 1000));
}

beforeEach(async () => {
  await db.delete(chatMessages);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'repo-ms', alias: 'ms', path: 'D:/nowhere/ms' });
  await db
    .insert(workItems)
    .values({ id: WORK_ITEM_ID, repoId: 'repo-ms', repoPath: 'D:/nowhere/ms', name: 'Ms' });
});

describe('chat rows record their milliseconds', () => {
  it('an agent turn', () => {
    const before = Date.now();
    persistCompletedTurn(
      WORK_ITEM_ID,
      {
        id: 'turn-ms',
        workItemId: WORK_ITEM_ID,
        agentName: 'Codex',
        items: [],
        status: 'complete',
        timestamp: Math.floor(before / 1000),
      },
      null
    );
    const after = Date.now();
    const [row] = db.select().from(chatMessages).where(eq(chatMessages.turnId, 'turn-ms')).all();
    expectStampedBetween(row.id, before, after);
  });

  it('a prompt', async () => {
    const before = Date.now();
    const { id } = await insertChatMessageRow({
      workItemId: WORK_ITEM_ID,
      content: 'hello',
      sessionId: null,
      metadata: '{}',
    });
    expectStampedBetween(id, before, Date.now());
  });

  it('a Reset marker', async () => {
    const before = Date.now();
    const id = await recordHistoryReset({
      workItemId: WORK_ITEM_ID,
      sessionId: 'session-ms',
      targetTurnId: 'turn-1',
      agentName: 'Codex',
    });
    expectStampedBetween(id, before, Date.now());
  });

  it("a teammate's row from the cloud keeps the cloud's milliseconds", () => {
    const id = '0b8f4a52-3a8e-4c43-9a55-6f0d2a1c9e11';
    ingestCloudChatMessage({
      id,
      work_item_id: WORK_ITEM_ID,
      session_id: null,
      sender_id: 'user-2',
      sender_type: 'human',
      sender_name: 'Grace',
      content: 'hi',
      message_type: 'text',
      metadata: {},
      created_at: '2026-10-06T08:00:00.250Z',
    });
    const row = readRow(id);
    expect(row.createdAtMs).toBe(Date.parse('2026-10-06T08:00:00.250Z'));
    expect(row.createdAt).toBe(Math.floor(Date.parse('2026-10-06T08:00:00.250Z') / 1000));
  });
});

describe('toCloudChatBulkMessage', () => {
  it('sends the row time to the millisecond', () => {
    const wire = toCloudChatBulkMessage({
      id: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      workItemId: WORK_ITEM_ID,
      sessionId: null,
      senderType: 'human',
      senderName: 'Ada',
      content: 'hello',
      messageType: 'text',
      metadata: '{}',
      createdAt: 1_791_273_694,
      createdAtMs: 1_791_273_694_300,
    });
    expect(wire?.created_at).toBe(new Date(1_791_273_694_300).toISOString());
  });
});
