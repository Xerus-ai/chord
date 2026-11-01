import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ServerEvent } from '@chord/protocol';
import type { eq as EqFn, inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { AuthClaims } from '../middleware/auth.js';
import type { AuthenticatedWebSocket, ConnectionManager } from '../ws/connection-manager.js';

/**
 * Real-DB tests for REST POST /work-items/:id/messages (devstation-3iw). It
 * used to insert and return, so a row posted this way reached nobody live and
 * told no offline member. It now writes through the same path as the socket's
 * chat_message: the thread must belong to the work item, the room hears the
 * row, and offline principals get a new_message notification.
 */
describe('POST /work-items/:id/messages (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', ''); // force real access checks, not the owner bypass

  let db: Database;
  let s: ServerSchema;
  let eq: typeof EqFn;
  let inArray: typeof InArrayFn;
  let manager: ConnectionManager;

  let server: ReturnType<Express['listen']>;
  let base: string;
  let currentUser: AuthClaims | null = null;

  const created = { users: [] as string[], orgs: [] as string[], workItems: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ eq, inArray } = await import('drizzle-orm'));
    const { ConnectionManager } = await import('../ws/connection-manager.js');
    const { createMessagesRouter } = await import('./messages.js');
    manager = new ConnectionManager();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (currentUser) (req as unknown as { user: AuthClaims }).user = currentUser;
      next();
    });
    app.use('/work-items/:work_item_id/messages', createMessagesRouter(manager));

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.users.length) {
      await db.delete(s.notifications).where(inArray(s.notifications.user_id, created.users));
      // addConnection and joinRoom write presence rows for the open sockets.
      await db.delete(s.presence).where(inArray(s.presence.user_id, created.users));
    }
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

  function claims(userId: string): AuthClaims {
    return {
      userId,
      orgId: null,
      role: null,
      email: `${userId}@test.example.com`,
      permissions: [],
      sessionId: `session_${userId}`,
    };
  }

  async function makeUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(s.users).values({ id, email: `${id}@test.example.com` });
    created.users.push(id);
    return id;
  }

  /** An item by `author`, shared with `editor` (Can edit) and `viewer` (Can view). */
  async function makeSharedItem(): Promise<{
    author: string;
    editor: string;
    viewer: string;
    workItemId: string;
    sessionId: string;
  }> {
    const [author, editor, viewer] = [await makeUser(), await makeUser(), await makeUser()];
    const orgId = randomUUID();
    await db.insert(s.organizations).values({ id: orgId, name: 'test-org' });
    created.orgs.push(orgId);
    const workItemId = randomUUID();
    await db
      .insert(s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: author, name: 'test item' });
    created.workItems.push(workItemId);
    for (const [userId, role] of [
      [editor, 'edit'],
      [viewer, 'view'],
    ] as const) {
      await db.insert(s.resourceMembers).values({
        id: randomUUID(),
        work_item_id: workItemId,
        artifact_id: null,
        user_id: userId,
        role,
        granted_by: author,
      });
    }
    const sessionId = randomUUID();
    await db
      .insert(s.workItemSessions)
      .values({ id: sessionId, work_item_id: workItemId, title: 'thread' });
    return { author, editor, viewer, workItemId, sessionId };
  }

  /** The surface ConnectionManager writes to: it records the frames sent. */
  function openSocket(userId: string): { ws: AuthenticatedWebSocket; sent: ServerEvent[] } {
    const sent: ServerEvent[] = [];
    const ws = {
      user: claims(userId),
      isAlive: true,
      rooms: new Set<string>(),
      lastSeen: new Date(),
      clientType: 'renderer',
      deviceId: null,
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 0,
      send: (raw: string) => sent.push(JSON.parse(raw) as ServerEvent),
      on: () => {},
      terminate: () => {},
    } as unknown as AuthenticatedWebSocket;
    manager.addConnection(ws);
    return { ws, sent };
  }

  function postMessage(workItemId: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${base}/work-items/${workItemId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('delivers the row to the room and notifies an offline member', async () => {
    const item = await makeSharedItem();
    const owner = openSocket(item.author);
    manager.joinRoom(owner.ws, `work_item:${item.workItemId}`);

    currentUser = claims(item.editor);
    const res = await postMessage(item.workItemId, {
      content: 'hello from REST',
      message_type: 'text',
      session_id: item.sessionId,
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; session_id: string };
    expect(row.session_id).toBe(item.sessionId);

    const received = owner.sent.find((event) => event.type === 'chat_message_received') as
      | { payload: { id: string; sender_id: string; session_id: string | null } }
      | undefined;
    expect(received?.payload).toMatchObject({
      id: row.id,
      sender_id: item.editor,
      session_id: item.sessionId,
    });

    const notified = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.message_id, row.id));
    expect(notified.map((n) => [n.user_id, n.type])).toEqual([[item.viewer, 'new_message']]);
  });

  it('refuses a thread of another work item, storing and sending nothing', async () => {
    const item = await makeSharedItem();
    const other = await makeSharedItem();
    const owner = openSocket(item.author);
    manager.joinRoom(owner.ws, `work_item:${item.workItemId}`);

    currentUser = claims(item.editor);
    const id = randomUUID();
    const res = await postMessage(item.workItemId, {
      id,
      content: 'misaddressed',
      message_type: 'text',
      session_id: other.sessionId,
    });
    expect(res.status).toBe(400);

    const rows = await db.select().from(s.chatMessages).where(eq(s.chatMessages.id, id));
    expect(rows).toHaveLength(0);
    expect(owner.sent.filter((event) => event.type === 'chat_message_received')).toHaveLength(0);
  });

  it('a retry by the sender echoes the stored row and delivers nothing again', async () => {
    const item = await makeSharedItem();
    const owner = openSocket(item.author);
    manager.joinRoom(owner.ws, `work_item:${item.workItemId}`);

    currentUser = claims(item.editor);
    const body = { id: randomUUID(), content: 'once', message_type: 'text' };
    expect((await postMessage(item.workItemId, body)).status).toBe(201);
    const retry = await postMessage(item.workItemId, body);
    expect(retry.status).toBe(200);

    expect(owner.sent.filter((event) => event.type === 'chat_message_received')).toHaveLength(1);
    const notified = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.message_id, body.id));
    expect(notified).toHaveLength(1);
  });
});
