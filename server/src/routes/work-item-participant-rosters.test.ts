import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * Real-DB route tests for GET /work-items/participant-rosters — the bulk
 * roster the dashboard reads so each card can show who an item is shared
 * with, in one request instead of one per card. Same database setup and
 * import-order convention as work-item-worktrees.test.ts.
 */
describe('GET /work-items/participant-rosters (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;

  let app: Express;
  let server: ReturnType<Express['listen']>;
  let base: string;

  let currentUserId: string | null = null;

  const created = { users: [] as string[], orgs: [] as string[], workItems: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    const client = await import('../db/client.js');
    db = client.db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ inArray } = await import('drizzle-orm'));
    const { createWorkItemsRouter } = await import('./work-items.js');

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
    app.use('/work-items', createWorkItemsRouter({} as unknown as ConnectionManager));

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.workItems.length) {
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

  async function makeUser(name: string): Promise<string> {
    const id = randomUUID();
    await db.insert(s.users).values({ id, email: `${id}@test.example.com`, name });
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

  async function share(
    workItemId: string,
    userId: string,
    role: 'view' | 'edit' = 'edit',
    artifactId: string | null = null
  ) {
    const [item] = await db
      .select({ creator_id: s.workItems.creator_id })
      .from(s.workItems)
      .where(inArray(s.workItems.id, [workItemId]));
    await db.insert(s.resourceMembers).values({
      id: randomUUID(),
      work_item_id: workItemId,
      artifact_id: artifactId,
      user_id: userId,
      role,
      granted_by: item!.creator_id,
    });
  }

  interface RosterRow {
    work_item_id: string;
    user_id: string;
    role: string;
    name: string | null;
    email: string;
    avatar_url: string | null;
  }

  async function getRosters(): Promise<{ status: number; rows: RosterRow[] }> {
    const res = await fetch(`${base}/work-items/participant-rosters`);
    return { status: res.status, rows: res.ok ? ((await res.json()) as RosterRow[]) : [] };
  }

  it('returns the members of every item the caller created', async () => {
    const owner = await makeUser('Owner');
    const priya = await makeUser('Priya');
    const kami = await makeUser('Kami');
    const first = await makeWorkItem(owner);
    const second = await makeWorkItem(owner);
    await share(first, priya);
    await share(first, kami, 'view');
    await share(second, kami);

    currentUserId = owner;
    const { status, rows } = await getRosters();

    expect(status).toBe(200);
    const byItem = (id: string) =>
      rows
        .filter((row) => row.work_item_id === id)
        .map((row) => `${row.name}:${row.role}`)
        .sort();
    expect(byItem(first)).toEqual(['Kami:view', 'Priya:edit']);
    expect(byItem(second)).toEqual(['Kami:edit']);
  });

  it('leaves out artifact-only members and pending invites', async () => {
    const owner = await makeUser('Owner');
    const reader = await makeUser('Reader');
    const item = await makeWorkItem(owner);
    const artifactId = randomUUID();
    await db.insert(s.artifacts).values({ id: artifactId, work_item_id: item, name: 'plan.md' });
    await share(item, reader, 'view', artifactId);
    await db.insert(s.resourceMembers).values({
      id: randomUUID(),
      work_item_id: item,
      invited_email: 'later@elsewhere.dev',
      role: 'view',
      granted_by: owner,
    });

    currentUserId = owner;
    const { status, rows } = await getRosters();

    expect(status).toBe(200);
    expect(rows.filter((row) => row.work_item_id === item)).toEqual([]);
  });

  it('never returns the author as a member', async () => {
    const owner = await makeUser('Solo');
    const item = await makeWorkItem(owner);

    currentUserId = owner;
    const { status, rows } = await getRosters();

    expect(status).toBe(200);
    expect(rows.filter((row) => row.work_item_id === item)).toEqual([]);
  });

  // Rosters carry emails, so ownership is the access check: an item the
  // caller only participates in is not theirs to enumerate.
  it("never returns another user's item, even one the caller is shared on", async () => {
    const owner = await makeUser('Other owner');
    const caller = await makeUser('Caller');
    const bystander = await makeUser('Bystander');
    const theirs = await makeWorkItem(owner);
    await share(theirs, caller);
    await share(theirs, bystander);

    currentUserId = caller;
    const { status, rows } = await getRosters();

    expect(status).toBe(200);
    expect(rows.some((row) => row.work_item_id === theirs)).toBe(false);
  });
});
