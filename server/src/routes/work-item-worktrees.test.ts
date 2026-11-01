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
 * Real-DB route tests for T0.8 (cloud sync of worktree metadata). Same
 * database setup (PGlite, or TEST_DATABASE_URL) and import-order convention as org-lifecycle.test.ts: modules are
 * imported dynamically after DATABASE_URL/DEV_MODE are stubbed, since
 * client.ts and access-control.ts read them at import time.
 */
describe('work item worktrees routes (real DB)', () => {
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
    const { createWorkItemWorktreesRouter } = await import('./work-item-worktrees.js');

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
      '/work-items/:work_item_id/worktrees',
      createWorkItemWorktreesRouter(fakeConnectionManager)
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.workItems.length) {
      await db
        .delete(s.workItemWorktrees)
        .where(inArray(s.workItemWorktrees.work_item_id, created.workItems));
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

  it('rejects a PUT from a user with no access to the work item', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    const stranger = await makeUser();

    currentUserId = stranger;
    const res = await fetch(`${base}/work-items/${workItemId}/worktrees`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worktrees: [] }),
    });
    // Invisible, not forbidden: no access is a 404 (P6 — private until shared).
    expect(res.status).toBe(404);
  });

  it('replaces the worktree set and broadcasts the update', async () => {
    const owner = await makeUser();
    const workItemId = await makeWorkItem(owner);
    currentUserId = owner;

    const primaryId = randomUUID();
    const secondaryId = randomUUID();
    const firstPut = await fetch(`${base}/work-items/${workItemId}/worktrees`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worktrees: [
          {
            id: primaryId,
            branch_name: 'main',
            base_branch: null,
            title: null,
            is_primary: true,
            status_bucket: 'idle',
            additions: 0,
            deletions: 0,
            diff_known: true,
            archived_at: null,
          },
          {
            id: secondaryId,
            branch_name: 'main--tests',
            base_branch: 'main',
            title: 'tests',
            is_primary: false,
            status_bucket: 'working',
            additions: 12,
            deletions: 3,
            diff_known: true,
            archived_at: null,
          },
        ],
      }),
    });
    expect(firstPut.status).toBe(200);
    const firstBody = (await firstPut.json()) as { worktrees: unknown[] };
    expect(firstBody.worktrees).toHaveLength(2);
    expect(broadcastToRoom).toHaveBeenCalledTimes(1);
    expect(broadcastToRoom.mock.calls[0]?.[1]).toMatchObject({
      type: 'work_item_worktrees_updated',
      payload: { work_item_id: workItemId },
    });

    // Second PUT lists only the primary — replace semantics must delete the
    // secondary row entirely, not merely leave it stale.
    const secondPut = await fetch(`${base}/work-items/${workItemId}/worktrees`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worktrees: [
          {
            id: primaryId,
            branch_name: 'main',
            base_branch: null,
            title: null,
            is_primary: true,
            status_bucket: 'ready_to_review',
            additions: 1,
            deletions: 1,
            diff_known: true,
            archived_at: null,
          },
        ],
      }),
    });
    expect(secondPut.status).toBe(200);

    const rows = await db
      .select()
      .from(s.workItemWorktrees)
      .where(eq(s.workItemWorktrees.work_item_id, workItemId));
    expect(rows.map((row) => row.id)).toEqual([primaryId]);
    expect(rows[0]?.status_bucket).toBe('ready_to_review');
  });
});
