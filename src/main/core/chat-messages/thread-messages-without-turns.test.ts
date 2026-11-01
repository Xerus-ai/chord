import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A chat thread renders its agent turns from the timeline
 * (`getTimelineTurns`); the `agent_turn` rows `getMessages` also returned —
 * every tool call and output of every turn — were mapped to empty
 * placeholders and dropped. On a 1,280-row session that was 1.5 MB of the
 * 2.1 MB read on every open (2026-10-15). A thread reads without them.
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
const { chatMessagesController } = await import('./controller');

const WORK_ITEM_ID = 'wi-thread';
const SESSION_ID = 'session-thread';

function row(
  id: string,
  at: number,
  fields: { sessionId: string | null; senderType: string; messageType: string; content: string }
) {
  return {
    id,
    workItemId: WORK_ITEM_ID,
    sessionId: fields.sessionId,
    senderType: fields.senderType,
    senderName: fields.senderType === 'human' ? 'Ada' : 'Claude Code',
    content: fields.content,
    messageType: fields.messageType,
    metadata:
      fields.messageType === 'agent_turn' ? '{"turnId":"t","items":[{"kind":"text"}]}' : '{}',
    createdAt: Math.floor(at / 1000),
    createdAtMs: at,
  };
}

beforeEach(async () => {
  await db.delete(chatMessages);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'repo-thread', alias: 't', path: 'D:/nowhere/t' });
  await db
    .insert(workItems)
    .values({ id: WORK_ITEM_ID, repoId: 'repo-thread', repoPath: 'D:/nowhere/t', name: 'T' });
  await db.insert(chatMessages).values([
    row('prompt', 1_000, {
      sessionId: SESSION_ID,
      senderType: 'human',
      messageType: 'text',
      content: 'go',
    }),
    row('turn', 2_000, {
      sessionId: SESSION_ID,
      senderType: 'agent',
      messageType: 'agent_turn',
      content: '',
    }),
    row('commit', 3_000, {
      sessionId: SESSION_ID,
      senderType: 'system',
      messageType: 'commit',
      content: 'abc',
    }),
    row('legacy', 4_000, {
      sessionId: null,
      senderType: 'human',
      messageType: 'text',
      content: 'old',
    }),
    row('other', 5_000, {
      sessionId: 'session-other',
      senderType: 'human',
      messageType: 'text',
      content: 'no',
    }),
  ]);
});

describe('chatMessages.getMessages for a thread', () => {
  it('leaves out agent turn rows when asked, keeping every other row of the thread in order', async () => {
    const result = await chatMessagesController.getMessages(WORK_ITEM_ID, {
      sessionId: SESSION_ID,
      withoutTurns: true,
    });

    expect(result.data.messages.map((m) => m.id)).toEqual(['prompt', 'commit', 'legacy']);
  });

  it('still returns the agent turn rows by default', async () => {
    const result = await chatMessagesController.getMessages(WORK_ITEM_ID, {
      sessionId: SESSION_ID,
    });

    expect(result.data.messages.map((m) => m.id)).toEqual(['prompt', 'turn', 'commit', 'legacy']);
  });
});
