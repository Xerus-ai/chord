import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * Real-DB route tests for registering a work item's artifact. Same database
 * setup and dynamic-import convention as work-item-sessions.test.ts: client.ts
 * and access-control.ts read env at import time, so modules are imported only
 * after DATABASE_URL/DEV_MODE are stubbed.
 */
describe('work item artifacts routes (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', ''); // force real access checks, not the owner bypass

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;

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
    ({ inArray } = await import('drizzle-orm'));
    const { createWorkItemArtifactsRouter } = await import('./work-item-artifacts.js');

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
      '/work-items/:work_item_id/artifacts',
      createWorkItemArtifactsRouter(fakeConnectionManager)
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    broadcastToRoom.mockClear();
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.workItems.length) {
      await db.delete(s.artifacts).where(inArray(s.artifacts.work_item_id, created.workItems));
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

  function registerArtifact(workItemId: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${base}/work-items/${workItemId}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('tells the work-item room an artifact was registered, so an open teammate view lists it', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;
    const artifactId = randomUUID();

    const res = await registerArtifact(workItemId, {
      id: artifactId,
      name: 'page.html',
      content_type: 'web',
    });

    expect(res.status).toBe(201);
    expect(broadcastToRoom).toHaveBeenCalledWith(`work_item:${workItemId}`, {
      type: 'artifact_registered',
      payload: { work_item_id: workItemId, artifact_id: artifactId },
    });
  });

  // devstation-664: the owner's status reaches the cloud through the register,
  // which is an idempotent upsert, so a status change is a re-register.
  async function storedStatus(artifactId: string): Promise<string | null> {
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ status: s.artifacts.status })
      .from(s.artifacts)
      .where(eq(s.artifacts.id, artifactId));
    return row.status;
  }

  it('stores the status a register carries, and a re-register changes it', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;
    const artifactId = randomUUID();
    const body = { id: artifactId, name: 'plan.md', content_type: 'markdown' };

    expect((await registerArtifact(workItemId, { ...body, status: 'in_review' })).status).toBe(201);
    expect(await storedStatus(artifactId)).toBe('in_review');

    expect((await registerArtifact(workItemId, { ...body, status: 'approved' })).status).toBe(201);
    expect(await storedStatus(artifactId)).toBe('approved');
  });

  it('a register without a status (an older desktop build) has none, and keeps one already set', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;
    const fresh = randomUUID();
    await registerArtifact(workItemId, { id: fresh, name: 'a.md', content_type: 'markdown' });
    expect(await storedStatus(fresh)).toBeNull();

    const set = randomUUID();
    const body = { id: set, name: 'b.md', content_type: 'markdown' };
    await registerArtifact(workItemId, { ...body, status: 'built' });
    await registerArtifact(workItemId, body);
    expect(await storedStatus(set)).toBe('built');
  });

  it('refuses a status the app does not have', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const res = await registerArtifact(workItemId, {
      id: randomUUID(),
      name: 'c.md',
      content_type: 'markdown',
      status: 'in_progress',
    });

    expect(res.status).toBe(400);
    expect(broadcastToRoom).not.toHaveBeenCalled();
  });

  it('tells no room when the register is refused', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const res = await registerArtifact(workItemId, {
      id: randomUUID(),
      name: 'odd.bin',
      content_type: 'not-a-type',
    });

    expect(res.status).toBe(400);
    expect(broadcastToRoom).not.toHaveBeenCalled();
  });
});
