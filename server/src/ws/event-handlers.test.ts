import { randomUUID } from 'node:crypto';
import type { eq as EqFn, inArray as InArrayFn } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { AuthenticatedWebSocket, ConnectionManager } from './connection-manager.js';
import type { handleChatMessage as HandleChatMessageFn } from './event-handlers.js';

/**
 * Real-DB tests for the thread addressing added with the cloud session
 * registry (devstation-uka). Before it, handleChatMessage stamped
 * `session_id: null` on every live participant message — a teammate could not
 * address one of two agent threads, and the null-session history set grew
 * forever. These pin the three cases that matter: a valid thread is recorded,
 * an unknown one is REFUSED rather than silently redirected, and a client that
 * names no thread still works.
 */
describe('handleChatMessage session addressing (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let eq: typeof EqFn;
  let inArray: typeof InArrayFn;
  let handleChatMessage: typeof HandleChatMessageFn;

  const created = { users: [] as string[], orgs: [] as string[], workItems: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ eq, inArray } = await import('drizzle-orm'));
    ({ handleChatMessage } = await import('./event-handlers.js'));
  });

  afterAll(async () => {
    if (created.workItems.length) {
      await db
        .delete(s.chatMessages)
        .where(inArray(s.chatMessages.work_item_id, created.workItems));
      await db
        .delete(s.workItemSessions)
        .where(inArray(s.workItemSessions.work_item_id, created.workItems));
      await db.delete(s.workItems).where(inArray(s.workItems.id, created.workItems));
    }
    if (created.orgs.length) {
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    }
    if (created.users.length) {
      await db.delete(s.users).where(inArray(s.users.id, created.users));
    }
    await testDb.stop();
  });

  async function makeSharedWorkItem(): Promise<{ userId: string; workItemId: string }> {
    const userId = randomUUID();
    await db.insert(s.users).values({ id: userId, email: `${userId}@test.example.com` });
    created.users.push(userId);

    const orgId = randomUUID();
    await db.insert(s.organizations).values({ id: orgId, name: 'test-org' });
    created.orgs.push(orgId);

    const workItemId = randomUUID();
    await db
      .insert(s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: userId, name: 'test item' });
    created.workItems.push(workItemId);

    return { userId, workItemId };
  }

  async function makeSession(workItemId: string, title: string): Promise<string> {
    const id = randomUUID();
    await db.insert(s.workItemSessions).values({ id, work_item_id: workItemId, title });
    return id;
  }

  function fakeSocket(userId: string): {
    ws: AuthenticatedWebSocket;
    sent: unknown[];
  } {
    const sent: unknown[] = [];
    const ws = {
      user: { userId, email: `${userId}@test.example.com` },
      rooms: new Set<string>(),
      send: (raw: string) => sent.push(JSON.parse(raw)),
    } as unknown as AuthenticatedWebSocket;
    return { ws, sent };
  }

  function fakeManager(): { manager: ConnectionManager; broadcasts: unknown[] } {
    const broadcasts: unknown[] = [];
    const manager = {
      joinRoom: vi.fn(),
      broadcastToRoom: (_room: string, payload: unknown) => broadcasts.push(payload),
      broadcastToUser: vi.fn(),
      getRoomMembers: () => [],
      isUserOnline: () => false,
    } as unknown as ConnectionManager;
    return { manager, broadcasts };
  }

  it('records the thread a message was typed into, and echoes it in the broadcast', async () => {
    const { userId, workItemId } = await makeSharedWorkItem();
    const sessionId = await makeSession(workItemId, 'thread one');
    const { ws } = fakeSocket(userId);
    const { manager, broadcasts } = fakeManager();

    const messageId = randomUUID();
    await handleChatMessage(
      ws,
      {
        type: 'chat_message',
        payload: {
          id: messageId,
          work_item_id: workItemId,
          session_id: sessionId,
          content: 'hello thread one',
          message_type: 'text',
        },
      },
      manager
    );

    const [row] = await db.select().from(s.chatMessages).where(eq(s.chatMessages.id, messageId));
    expect(row.session_id).toBe(sessionId);

    const received = broadcasts.find(
      (b) => (b as { type: string }).type === 'chat_message_received'
    ) as { payload: { session_id: string | null } };
    expect(received.payload.session_id).toBe(sessionId);
  });

  it('refuses a session id that does not belong to the work item, storing nothing', async () => {
    const { userId, workItemId } = await makeSharedWorkItem();
    const other = await makeSharedWorkItem();
    const foreignSession = await makeSession(other.workItemId, 'someone else thread');
    const { ws, sent } = fakeSocket(userId);
    const { manager, broadcasts } = fakeManager();

    const messageId = randomUUID();
    await handleChatMessage(
      ws,
      {
        type: 'chat_message',
        payload: {
          id: messageId,
          work_item_id: workItemId,
          session_id: foreignSession,
          content: 'misaddressed',
          message_type: 'text',
        },
      },
      manager
    );

    const rows = await db.select().from(s.chatMessages).where(eq(s.chatMessages.id, messageId));
    expect(rows).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
    expect(sent).toContainEqual(
      expect.objectContaining({ type: 'error', payload: expect.stringContaining('session') })
    );
  });

  it('stores null for a client that names no thread', async () => {
    const { userId, workItemId } = await makeSharedWorkItem();
    const { ws } = fakeSocket(userId);
    const { manager } = fakeManager();

    const messageId = randomUUID();
    await handleChatMessage(
      ws,
      {
        type: 'chat_message',
        payload: {
          id: messageId,
          work_item_id: workItemId,
          content: 'no thread named',
          message_type: 'text',
        },
      },
      manager
    );

    const [row] = await db.select().from(s.chatMessages).where(eq(s.chatMessages.id, messageId));
    expect(row.session_id).toBeNull();
  });
});
