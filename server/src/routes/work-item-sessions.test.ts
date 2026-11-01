import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { eq as EqFn, inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * Real-DB route tests for the cloud session registry (devstation-uka). Same
 * database setup and dynamic-import convention as work-item-worktrees.test.ts:
 * client.ts and access-control.ts read env at import time, so modules are
 * imported only after DATABASE_URL/DEV_MODE are stubbed.
 */
describe('work item sessions routes (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', ''); // force real access checks, not the owner bypass

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;
  let eq: typeof EqFn;

  let app: Express;
  let server: ReturnType<Express['listen']>;
  let base: string;

  let currentUserId: string | null = null;
  const broadcastToRoom = vi.fn();

  const created = { users: [] as string[], orgs: [] as string[], workItems: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    const client = await import('../db/client.js');
    db = client.db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ inArray, eq } = await import('drizzle-orm'));
    const { createWorkItemSessionsRouter } = await import('./work-item-sessions.js');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (currentUserId) {
        (req as unknown as { user: { userId: string; orgId: string } }).user = {
          userId: currentUserId,
          orgId: '',
        };
      }
      next();
    });
    const fakeConnectionManager = { broadcastToRoom } as unknown as ConnectionManager;
    app.use(
      '/work-items/:work_item_id/sessions',
      createWorkItemSessionsRouter(fakeConnectionManager)
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.workItems.length) {
      await db
        .delete(s.workItemSessions)
        .where(inArray(s.workItemSessions.work_item_id, created.workItems));
      await db.delete(s.workItems).where(inArray(s.workItems.id, created.workItems));
    }
    if (created.orgs.length) {
      await db.delete(s.orgMemberships).where(inArray(s.orgMemberships.org_id, created.orgs));
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    }
    if (created.users.length) {
      await db.delete(s.users).where(inArray(s.users.id, created.users));
    }
    await testDb.stop();
  });

  async function makeUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(s.users).values({ id, email: `${id}@test.example.com` });
    created.users.push(id);
    return id;
  }

  async function makeWorkItem(creatorId: string): Promise<string> {
    const orgId = randomUUID();
    await db.insert(s.organizations).values({ id: orgId, name: 'test-org' });
    created.orgs.push(orgId);

    const workItemId = randomUUID();
    await db.insert(s.workItems).values({
      id: workItemId,
      org_id: orgId,
      creator_id: creatorId,
      name: 'test item',
    });
    created.workItems.push(workItemId);
    return workItemId;
  }

  function putSessions(workItemId: string, sessions: unknown[]): Promise<Response> {
    return fetch(`${base}/work-items/${workItemId}/sessions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions }),
    });
  }

  function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: randomUUID(),
      agent_provider_id: 'claude',
      title: 'Fix the parser',
      status: 'active',
      worktree_id: null,
      last_active_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('rejects a PUT from a user with no access to the work item', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    const stranger = await makeUser();

    currentUserId = stranger;
    const res = await putSessions(workItemId, []);
    // 404, not 403: a work item the caller has no access to is invisible
    // (P6 — private until shared); existence is never disclosed.
    expect(res.status).toBe(404);
  });

  it('replaces the whole set: upserts what is listed, deletes what is not', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const keep = entry({ title: 'thread one' });
    const drop = entry({ title: 'thread two', agent_provider_id: 'codex' });

    const first = await putSessions(workItemId, [keep, drop]);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { sessions: Array<{ id: string; title: string }> };
    expect(firstBody.sessions).toHaveLength(2);
    expect(broadcastToRoom).toHaveBeenCalledWith(
      `work_item:${workItemId}`,
      expect.objectContaining({ type: 'work_item_sessions_updated' })
    );

    // Second push lists only `keep`, with a changed title and status.
    const second = await putSessions(workItemId, [
      { ...keep, title: 'thread one renamed', status: 'done' },
    ]);
    expect(second.status).toBe(200);

    const rows = await db
      .select()
      .from(s.workItemSessions)
      .where(eq(s.workItemSessions.work_item_id, workItemId));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(keep.id);
    expect(rows[0].title).toBe('thread one renamed');
    expect(rows[0].status).toBe('done');
  });

  it('empties the set when an empty list is pushed', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    await putSessions(workItemId, [entry()]);
    const res = await putSessions(workItemId, []);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(s.workItemSessions)
      .where(eq(s.workItemSessions.work_item_id, workItemId));
    expect(rows).toHaveLength(0);
  });

  it('refuses to rewrite a session id owned by another work item', async () => {
    const owner = await makeUser();
    const itemA = await makeWorkItem(owner);
    const itemB = await makeWorkItem(owner);
    currentUserId = owner;

    const shared = entry({ title: 'belongs to A' });
    await putSessions(itemA, [shared]);

    const res = await putSessions(itemB, [{ ...shared, title: 'stolen by B' }]);
    expect(res.status).toBe(409);

    const rows = await db
      .select()
      .from(s.workItemSessions)
      .where(eq(s.workItemSessions.id, String(shared.id)));
    expect(rows[0].work_item_id).toBe(itemA);
    expect(rows[0].title).toBe('belongs to A');
  });

  it('rejects a body whose entries do not match the wire shape', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const res = await putSessions(workItemId, [entry({ status: 'definitely-not-a-status' })]);
    expect(res.status).toBe(400);
  });

  it("keeps the owner's model and mode labels, and hands them to teammates", async () => {
    // User decision 2026-10-01: a teammate's composer shows them, disabled.
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const labelled = entry({ model_label: 'Opus 4.5', permission_mode_label: 'Ask before edits' });
    const res = await putSessions(workItemId, [labelled]);
    expect(res.status).toBe(200);

    const { fetchSessionsForWorkItems } = await import('./work-item-sessions.js');
    const [published] = (await fetchSessionsForWorkItems([workItemId])).get(workItemId) ?? [];
    expect(published).toMatchObject({
      model_label: 'Opus 4.5',
      permission_mode_label: 'Ask before edits',
    });
  });

  it('stores no labels from an owner app that sends none', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const res = await putSessions(workItemId, [entry()]);
    expect(res.status).toBe(200);

    const { fetchSessionsForWorkItems } = await import('./work-item-sessions.js');
    const [published] = (await fetchSessionsForWorkItems([workItemId])).get(workItemId) ?? [];
    expect(published).toMatchObject({ model_label: null, permission_mode_label: null });
  });

  it('fetchSessionsForWorkItems groups rows by work item', async () => {
    const owner = await makeUser();
    const itemA = await makeWorkItem(owner);
    const itemB = await makeWorkItem(owner);
    currentUserId = owner;

    await putSessions(itemA, [entry(), entry()]);
    await putSessions(itemB, [entry()]);

    const { fetchSessionsForWorkItems } = await import('./work-item-sessions.js');
    const byWorkItem = await fetchSessionsForWorkItems([itemA, itemB]);
    expect(byWorkItem.get(itemA)).toHaveLength(2);
    expect(byWorkItem.get(itemB)).toHaveLength(1);
  });
});
