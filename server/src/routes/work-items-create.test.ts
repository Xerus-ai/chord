import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * POST /work-items with a client-supplied id (devstation-as2). The sync queue
 * re-sends creates whenever its creator-scoped listing and the cloud
 * disagree, so the route must be idempotent for the caller's own id — the
 * existing row, with its version_number, so the desktop can stamp the local
 * row as synced — and must refuse an id another creator holds: client ids
 * are attacker-suppliable. Same harness as work-item-sessions.test.ts.
 */
describe('POST /work-items with a client id (real DB)', () => {
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
    const fakeConnectionManager = {
      broadcastToRoom: vi.fn(),
      hasDeviceOnline: () => false,
    } as unknown as ConnectionManager;
    app.use('/work-items', createWorkItemsRouter(fakeConnectionManager));

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

  function post(id: string): Promise<Response> {
    return fetch(`${base}/work-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: 'item', org_id: orgId }),
    });
  }

  it("answers the caller's own id with the existing row, not a duplicate", async () => {
    currentUserId = await makeMember();
    const id = randomUUID();

    const first = await post(id);
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string; version_number: number };

    const again = await post(id);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      id,
      creator_id: currentUserId,
      version_number: created.version_number,
    });
  });

  it('refuses an id another creator holds', async () => {
    currentUserId = await makeMember();
    const id = randomUUID();
    expect((await post(id)).status).toBe(201);

    currentUserId = await makeMember();
    const res = await post(id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Work item id already exists' });
  });
});
