import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type * as ActivateNS from './activate-pending-members.js';
import type * as ResolveAccessNS from './resolve-access.js';

/**
 * An invite to someone outside the team is a pending member row keyed by
 * email. It must grant nothing until that person is in the work item's team,
 * and then become a real member exactly once.
 */
describe('activatePendingMembers (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let activate: typeof ActivateNS;
  let resolve: typeof ResolveAccessNS;

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    activate = await import('./activate-pending-members.js');
    resolve = await import('./resolve-access.js');
  });

  afterAll(() => testDb.stop());

  async function scenario() {
    const author = randomUUID();
    const invitee = randomUUID();
    const inviteeEmail = `${invitee.slice(0, 8)}@Elsewhere.dev`;
    await db.insert(s.users).values([
      { id: author, email: `${author}@x.dev` },
      { id: invitee, email: inviteeEmail.toLowerCase() },
    ]);
    const orgId = randomUUID();
    await db.insert(s.organizations).values({ id: orgId, name: 'team' });
    await db.insert(s.orgMemberships).values({ org_id: orgId, user_id: author, role: 'owner' });
    const workItemId = randomUUID();
    await db
      .insert(s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: author, name: 'item' });
    await db.insert(s.resourceMembers).values({
      id: randomUUID(),
      work_item_id: workItemId,
      invited_email: inviteeEmail,
      role: 'edit',
      granted_by: author,
    });
    return { invitee, inviteeEmail: inviteeEmail.toLowerCase(), orgId, workItemId };
  }

  it('does nothing while the invitee is outside the team', async () => {
    const { invitee, inviteeEmail, workItemId } = await scenario();

    expect(await activate.activatePendingMembers(invitee, inviteeEmail)).toEqual([]);
    expect(await resolve.resolveWorkItemAccess(invitee, workItemId)).toBeNull();
  });

  it('turns the pending row into a member once they join the team, case-insensitively', async () => {
    const { invitee, inviteeEmail, orgId, workItemId } = await scenario();
    await db.insert(s.orgMemberships).values({ org_id: orgId, user_id: invitee });

    expect(await activate.activatePendingMembers(invitee, inviteeEmail)).toEqual([
      expect.objectContaining({ work_item_id: workItemId, artifact_id: null, role: 'edit' }),
    ]);
    expect(await resolve.resolveWorkItemAccess(invitee, workItemId)).toMatchObject({
      role: 'edit',
      source: 'member',
    });
    expect(await activate.activatePendingMembers(invitee, inviteeEmail)).toEqual([]);
  });

  it('keeps the existing member row when one already exists', async () => {
    const { invitee, inviteeEmail, orgId, workItemId } = await scenario();
    await db.insert(s.orgMemberships).values({ org_id: orgId, user_id: invitee });
    await db.insert(s.resourceMembers).values({
      id: randomUUID(),
      work_item_id: workItemId,
      user_id: invitee,
      role: 'view',
      granted_by: invitee,
    });

    await activate.activatePendingMembers(invitee, inviteeEmail);

    const { eq } = await import('drizzle-orm');
    const rows = await db
      .select({ user_id: s.resourceMembers.user_id, role: s.resourceMembers.role })
      .from(s.resourceMembers)
      .where(eq(s.resourceMembers.work_item_id, workItemId));
    expect(rows).toEqual([{ user_id: invitee, role: 'view' }]);
  });
});
