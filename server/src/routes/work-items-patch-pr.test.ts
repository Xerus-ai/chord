import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * PATCH /work-items/:id carries the desktop's mirror of the primary lane's PR
 * (plan 2026-09-26 P8). Promoting a lane that has no PR must clear it, so the
 * route takes null for pr_number / pr_url and writes it through; a PATCH that
 * leaves the fields out must not touch them. Same harness as
 * work-items-create.test.ts.
 */
describe('PATCH /work-items/:id PR mirror (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let app: Express;
  let server: ReturnType<Express['listen']>;
  let base: string;
  let currentUserId: string | null = null;
  const broadcastToRoom = vi.fn();
  const orgId = randomUUID();

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
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
    const connectionManager = {
      broadcastToRoom,
      hasDeviceOnline: () => false,
    } as unknown as ConnectionManager;
    app.use('/work-items', createWorkItemsRouter(connectionManager));

    await db.insert(s.organizations).values({ id: orgId, name: 'test-org' });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await testDb.stop();
  });

  async function makeMember(): Promise<string> {
    const id = randomUUID();
    await db.insert(s.users).values({ id, email: `${id}@test.example.com` });
    await db.insert(s.orgMemberships).values({ org_id: orgId, user_id: id });
    return id;
  }

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  /** A work item whose PR mirror holds PR #7. */
  async function createItemWithPr(): Promise<string> {
    currentUserId = await makeMember();
    const id = randomUUID();
    expect((await request('POST', '/work-items', { id, name: 'item', org_id: orgId })).status).toBe(
      201
    );
    const linked = await request('PATCH', `/work-items/${id}`, {
      pr_number: 7,
      pr_url: 'https://github.com/acme/chord/pull/7',
    });
    expect(linked.status).toBe(200);
    return id;
  }

  async function readMirror(id: string) {
    const res = await request('GET', `/work-items/${id}`);
    const body = (await res.json()) as { pr_number: number | null; pr_url: string | null };
    return { pr_number: body.pr_number, pr_url: body.pr_url };
  }

  it('clears both PR fields when the PATCH sends null', async () => {
    const id = await createItemWithPr();

    const res = await request('PATCH', `/work-items/${id}`, { pr_number: null, pr_url: null });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pr_number: null, pr_url: null });
    expect(await readMirror(id)).toEqual({ pr_number: null, pr_url: null });
  });

  it('tells the room the PR was cleared', async () => {
    const id = await createItemWithPr();
    broadcastToRoom.mockClear();

    await request('PATCH', `/work-items/${id}`, { pr_number: null, pr_url: null });

    expect(broadcastToRoom).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: 'work_item_updated',
        payload: expect.objectContaining({
          work_item_id: id,
          changes: { pr_number: null, pr_url: null },
        }),
      })
    );
  });

  it('moves the mirror to another PR', async () => {
    const id = await createItemWithPr();

    await request('PATCH', `/work-items/${id}`, {
      pr_number: 12,
      pr_url: 'https://github.com/acme/chord/pull/12',
    });

    expect(await readMirror(id)).toEqual({
      pr_number: 12,
      pr_url: 'https://github.com/acme/chord/pull/12',
    });
  });

  it('leaves the PR fields alone when the PATCH omits them', async () => {
    const id = await createItemWithPr();

    expect((await request('PATCH', `/work-items/${id}`, { name: 'renamed' })).status).toBe(200);

    expect(await readMirror(id)).toEqual({
      pr_number: 7,
      pr_url: 'https://github.com/acme/chord/pull/7',
    });
  });
});
