import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NotificationView } from '@chord/protocol';
import type { inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type * as ConnectionNS from '../ws/connection-manager.js';
import type * as AnnounceNS from './sharing/announce-member-change.js';

/**
 * The persisted notification history (GET /notifications) must carry what a
 * click needs, and the names its sentence is built from. A "shared an artifact
 * with you" row is written by announceMemberChange with the artifact id (the
 * recipient may reach the artifact alone, so the click opens it) and its work
 * item (named as "from {work item}"); without the artifact id the row is a
 * dead click once the live WS frame is gone.
 *
 * Runs against in-process PGlite with the real migrations applied
 * (db/test-database.ts), through the real router.
 */
describe('GET /notifications (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;
  let announceMemberChange: typeof AnnounceNS.announceMemberChange;
  let ConnectionManager: typeof ConnectionNS.ConnectionManager;

  let server: ReturnType<Express['listen']>;
  let base: string;
  let currentUserId: string | null = null;
  const created = { users: [] as string[], orgs: [] as string[], items: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ inArray } = await import('drizzle-orm'));
    ({ announceMemberChange } = await import('./sharing/announce-member-change.js'));
    ({ ConnectionManager } = await import('../ws/connection-manager.js'));
    const { notificationsRouter } = await import('./notifications.js');

    const app: Express = express();
    app.use((req, _res, next) => {
      if (currentUserId) {
        (req as unknown as { user: { userId: string; email: string } }).user = {
          userId: currentUserId,
          email: `${currentUserId}@t9.test`,
        };
      }
      next();
    });
    app.use('/notifications', notificationsRouter);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notifications`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.users.length)
      await db.delete(s.notifications).where(inArray(s.notifications.user_id, created.users));
    if (created.items.length)
      await db.delete(s.workItems).where(inArray(s.workItems.id, created.items));
    if (created.orgs.length)
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    if (created.users.length) await db.delete(s.users).where(inArray(s.users.id, created.users));
    await testDb.stop();
  });

  async function seedUser(): Promise<string> {
    const id = `t9u_${randomUUID()}`;
    await db.insert(s.users).values({ id, email: `${id}@t9.test` });
    created.users.push(id);
    return id;
  }

  it('lists an artifact share with its artifact, its work item and their names', async () => {
    const sharerId = await seedUser();
    const recipientId = await seedUser();
    const orgId = `t9o_${randomUUID()}`;
    await db.insert(s.organizations).values({ id: orgId, name: 'T9 Org' });
    created.orgs.push(orgId);
    const workItemId = `t9w_${randomUUID()}`;
    await db
      .insert(s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: sharerId, name: 'T9 item' });
    created.items.push(workItemId);
    const artifactId = `t9a_${randomUUID()}`;
    await db
      .insert(s.artifacts)
      .values({ id: artifactId, work_item_id: workItemId, name: 'T9 memo' });

    await announceMemberChange(new ConnectionManager(), {
      ref: { workItemId, artifactId },
      userId: recipientId,
      email: `${recipientId}@t9.test`,
      role: 'view',
      previousRole: null,
      sharerId,
    });

    currentUserId = recipientId;
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as NotificationView[];
    expect(rows).toEqual([
      expect.objectContaining({
        type: 'shared_with_you',
        actor_user_id: sharerId,
        artifact_id: artifactId,
        artifact_name: 'T9 memo',
        work_item_id: workItemId,
        work_item_name: 'T9 item',
        excerpt: 'view',
      }),
    ]);
  });
});
