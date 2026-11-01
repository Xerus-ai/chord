import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { agentSessions, workItems } from '@main/db/schema-work-items';
import {
  getResumableExternalId,
  hasChatStarted,
  markChatStarted,
  recordChatExternalId,
  restoreChatResumeState,
} from './chat-resume-state';
import { reconcileSessionsOnStartup } from './reconcile-sessions-on-startup';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

// Both reach cloud sync and Electron-side stores; reconciliation's own
// decisions are what is under test, read back from the rows.
vi.mock('@main/core/agent-sessions/forget-ended-session', () => ({
  forgetEndedSession: vi.fn(),
}));
vi.mock('@main/core/agent-sessions/session-cloud-sync', () => ({
  scheduleSessionCloudSync: vi.fn(),
}));

const ITEM = 'item-1';

function insertChat(id: string, status: string, externalSessionId: string | null, at: number) {
  db.insert(agentSessions)
    .values({
      id,
      workItemId: ITEM,
      kind: 'chat',
      status,
      externalSessionId,
      lastActiveAt: at,
    })
    .run();
}

function statusOf(id: string): string {
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).all()[0].status;
}

describe('chat resume state is per session', () => {
  beforeEach(() => {
    db.delete(workItems).run();
    db.insert(workItems).values({ id: ITEM, name: 'item', repoPath: '/repo' }).run();
  });

  it('keeps two chats in one work item on their own conversations', () => {
    insertChat('chat-a', 'active', null, 1);
    insertChat('chat-b', 'active', null, 2);

    recordChatExternalId('chat-a', 'conv-a');
    recordChatExternalId('chat-b', 'conv-b');

    expect(getResumableExternalId('chat-a')).toBe('conv-a');
    expect(getResumableExternalId('chat-b')).toBe('conv-b');
    expect(
      db.select().from(agentSessions).where(eq(agentSessions.id, 'chat-a')).all()[0]
    ).toMatchObject({ externalSessionId: 'conv-a' });
  });

  it("never hands a new chat a sibling's conversation", () => {
    insertChat('chat-a', 'active', null, 1);
    recordChatExternalId('chat-a', 'conv-a');
    markChatStarted('chat-a');

    expect(getResumableExternalId('chat-new')).toBeUndefined();
    expect(hasChatStarted('chat-new')).toBe(false);
  });
});

describe('reconcileSessionsOnStartup', () => {
  beforeEach(() => {
    db.delete(workItems).run();
    db.insert(workItems).values({ id: ITEM, name: 'item', repoPath: '/repo' }).run();
  });

  it('restores every chat of a work item, each to its own conversation', () => {
    insertChat('chat-a', 'active', 'conv-a', 10);
    insertChat('chat-b', 'suspended', 'conv-b', 20);

    const resumable = reconcileSessionsOnStartup();
    restoreChatResumeState(resumable);

    expect(resumable.get('chat-a')).toBe('conv-a');
    expect(resumable.get('chat-b')).toBe('conv-b');
    expect(getResumableExternalId('chat-a')).toBe('conv-a');
    expect(getResumableExternalId('chat-b')).toBe('conv-b');
    expect(statusOf('chat-a')).toBe('suspended');
    expect(statusOf('chat-b')).toBe('suspended');
  });

  it('collapses rows of one conversation to the newest and retires unresumable rows', () => {
    insertChat('old-row', 'suspended', 'conv-a', 10);
    insertChat('new-row', 'suspended', 'conv-a', 20);
    insertChat('never-started', 'suspended', null, 30);

    const resumable = reconcileSessionsOnStartup();

    expect([...resumable.keys()]).toEqual(['new-row']);
    expect(statusOf('old-row')).toBe('done');
    expect(statusOf('never-started')).toBe('done');
  });
});
