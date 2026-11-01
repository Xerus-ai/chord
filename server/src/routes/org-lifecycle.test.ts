import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { eq as EqFn, inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';

/**
 * Real-DB route tests for the team-invite lifecycle. Per repo non-negotiables
 * these run against a real Postgres (a throwaway Neon branch), no mocks. The
 * one external dependency in the invitee auth path — the WorkOS-verified email
 * — is injected into the router as a stub email resolver; every other read and
 * write hits the real database.
 *
 * Runs against in-process PGlite with the real migrations applied (see
 * db/test-database.ts). Set TEST_DATABASE_URL to use a real Postgres instead —
 * an isolated branch, never a shared/prod DB: these tests write and delete rows.
 */
describe('org lifecycle routes (real DB)', () => {
  const testDb = createTestDatabase();
  // Modules are imported AFTER env is stubbed: client.ts reads DATABASE_URL and
  // access-control.ts reads DEV_MODE/hasDb at import time.
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test'); // quiets middleware/auth's boot guard
  vi.stubEnv('DEV_MODE', ''); // force real membership checks, not the owner bypass

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;
  let eq: typeof EqFn;

  let app: Express;
  let server: ReturnType<Express['listen']>;
  let base: string;

  // The injected auth identity and email resolver, mutated per test.
  let currentUserId: string | null = null;
  const emailByUser = new Map<string, string>();

  const created = { users: [] as string[], orgs: [] as string[], invites: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    const client = await import('../db/client.js');
    db = client.db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ inArray, eq } = await import('drizzle-orm'));
    const { createOrgLifecycleRouter } = await import('./org-lifecycle.js');
    const { ConnectionManager } = await import('../ws/connection-manager.js');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (currentUserId) {
        (req as unknown as { user: { userId: string; email: string } }).user = {
          userId: currentUserId,
          email: emailByUser.get(currentUserId) ?? '',
        };
      }
      next();
    });
    app.use(
      '/organizations',
      createOrgLifecycleRouter(
        new ConnectionManager(),
        async (userId) => emailByUser.get(userId) ?? null
      )
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/organizations`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.orgs.length) {
      await db.delete(s.orgMemberships).where(inArray(s.orgMemberships.org_id, created.orgs));
      await db.delete(s.teamInvites).where(inArray(s.teamInvites.org_id, created.orgs));
    }
    if (created.users.length) {
      await db.delete(s.notifications).where(inArray(s.notifications.user_id, created.users));
      await db.delete(s.orgMemberships).where(inArray(s.orgMemberships.user_id, created.users));
    }
    if (created.orgs.length)
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    if (created.users.length) await db.delete(s.users).where(inArray(s.users.id, created.users));
    await testDb.stop();
  });

  async function seedUser(email: string): Promise<string> {
    const id = `t8u_${randomUUID()}`;
    await db.insert(s.users).values({ id, email });
    created.users.push(id);
    emailByUser.set(id, email);
    return id;
  }
  async function seedOrg(): Promise<string> {
    const id = `t8o_${randomUUID()}`;
    await db.insert(s.organizations).values({ id, name: 'T8 Org' });
    created.orgs.push(id);
    return id;
  }
  async function seedInvite(
    orgId: string,
    inviterId: string,
    email: string,
    opts?: { status?: string; expiresAt?: Date }
  ): Promise<string> {
    const id = `t8i_${randomUUID()}`;
    await db.insert(s.teamInvites).values({
      id,
      org_id: orgId,
      inviter_id: inviterId,
      email,
      role: 'member',
      status: opts?.status ?? 'pending',
      expires_at: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    created.invites.push(id);
    return id;
  }

  const as = (userId: string) => {
    currentUserId = userId;
  };
  const post = (path: string) => fetch(`${base}${path}`, { method: 'POST' });
  const del = (path: string) => fetch(`${base}${path}`, { method: 'DELETE' });

  it('GET /invites/mine returns pending invites joined to org name', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });
    const inviteeEmail = `invitee_${randomUUID()}@t8.test`;
    const inviteeId = await seedUser(inviteeEmail);
    const inviteId = await seedInvite(orgId, ownerId, inviteeEmail);

    as(inviteeId);
    const res = await fetch(`${base}/invites/mine`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; org_name: string }>;
    const mine = body.find((i) => i.id === inviteId);
    expect(mine).toBeDefined();
    expect(mine?.org_name).toBe('T8 Org');
  });

  it('accept writes a member membership and marks the invite accepted', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });
    const email = `invitee_${randomUUID()}@t8.test`;
    const inviteeId = await seedUser(email);
    const inviteId = await seedInvite(orgId, ownerId, email);

    as(inviteeId);
    const res = await post(`/invites/${inviteId}/accept`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { org_id: string }).org_id).toBe(orgId);

    const [membership] = await db
      .select({ role: s.orgMemberships.role })
      .from(s.orgMemberships)
      .where(eq(s.orgMemberships.user_id, inviteeId));
    expect(membership?.role).toBe('member');

    const [invite] = await db
      .select({ status: s.teamInvites.status })
      .from(s.teamInvites)
      .where(eq(s.teamInvites.id, inviteId));
    expect(invite?.status).toBe('accepted');
  });

  // The load-bearing security check: acceptance authorizes by the verified
  // email, never membership or client input. Red-green — with the email check
  // removed this returns 200 and writes a membership.
  it('accept by the wrong email is 403 and writes no membership', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });
    const inviteId = await seedInvite(orgId, ownerId, `intended_${randomUUID()}@t8.test`);
    const attackerId = await seedUser(`attacker_${randomUUID()}@t8.test`);

    as(attackerId);
    const res = await post(`/invites/${inviteId}/accept`);
    expect(res.status).toBe(403);

    const rows = await db
      .select({ user_id: s.orgMemberships.user_id })
      .from(s.orgMemberships)
      .where(eq(s.orgMemberships.user_id, attackerId));
    expect(rows).toHaveLength(0);
  });

  it('accept of an expired invite is 410', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });
    const email = `expired_${randomUUID()}@t8.test`;
    const inviteeId = await seedUser(email);
    const inviteId = await seedInvite(orgId, ownerId, email, {
      expiresAt: new Date(Date.now() - 1000),
    });

    as(inviteeId);
    expect((await post(`/invites/${inviteId}/accept`)).status).toBe(410);
  });

  it('decline marks the invite declined without a membership', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });
    const email = `decliner_${randomUUID()}@t8.test`;
    const inviteeId = await seedUser(email);
    const inviteId = await seedInvite(orgId, ownerId, email);

    as(inviteeId);
    expect((await post(`/invites/${inviteId}/decline`)).status).toBe(200);
    const [invite] = await db
      .select({ status: s.teamInvites.status })
      .from(s.teamInvites)
      .where(eq(s.teamInvites.id, inviteId));
    expect(invite?.status).toBe('declined');
    const rows = await db
      .select({ user_id: s.orgMemberships.user_id })
      .from(s.orgMemberships)
      .where(eq(s.orgMemberships.user_id, inviteeId));
    expect(rows).toHaveLength(0);
  });

  it('revoke: owner revokes (200), a member cannot (403)', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const memberId = await seedUser(`member_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values([
      { user_id: ownerId, org_id: orgId, role: 'owner' },
      { user_id: memberId, org_id: orgId, role: 'member' },
    ]);
    const inviteId = await seedInvite(orgId, ownerId, `pending_${randomUUID()}@t8.test`);

    as(memberId);
    expect((await del(`/${orgId}/invites/${inviteId}`)).status).toBe(403);

    as(ownerId);
    expect((await del(`/${orgId}/invites/${inviteId}`)).status).toBe(200);
    const [invite] = await db
      .select({ status: s.teamInvites.status })
      .from(s.teamInvites)
      .where(eq(s.teamInvites.id, inviteId));
    expect(invite?.status).toBe('revoked');
  });

  it('remove member: owner removes a member; owner/self are protected (409)', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const memberId = await seedUser(`member_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values([
      { user_id: ownerId, org_id: orgId, role: 'owner' },
      { user_id: memberId, org_id: orgId, role: 'member' },
    ]);

    as(ownerId);
    expect((await del(`/${orgId}/members/${ownerId}`)).status).toBe(409); // self
    expect((await del(`/${orgId}/members/${memberId}`)).status).toBe(200);
    const rows = await db
      .select({ user_id: s.orgMemberships.user_id })
      .from(s.orgMemberships)
      .where(eq(s.orgMemberships.user_id, memberId));
    expect(rows).toHaveLength(0);
  });

  it('leave: a member leaves (200), the owner cannot (409)', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const memberId = await seedUser(`member_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values([
      { user_id: ownerId, org_id: orgId, role: 'owner' },
      { user_id: memberId, org_id: orgId, role: 'member' },
    ]);

    as(ownerId);
    expect((await post(`/${orgId}/leave`)).status).toBe(409);

    as(memberId);
    expect((await post(`/${orgId}/leave`)).status).toBe(200);
    const rows = await db
      .select({ user_id: s.orgMemberships.user_id })
      .from(s.orgMemberships)
      .where(eq(s.orgMemberships.user_id, memberId));
    expect(rows).toHaveLength(0);
  });

  // The single-owner invariant is enforced by uq_org_memberships_single_owner
  // (migration 0011). A second owner insert must be rejected by the DB.
  it('single-owner invariant: a second owner per org is rejected', async () => {
    const ownerId = await seedUser(`owner_${randomUUID()}@t8.test`);
    const otherId = await seedUser(`other_${randomUUID()}@t8.test`);
    const orgId = await seedOrg();
    await db.insert(s.orgMemberships).values({ user_id: ownerId, org_id: orgId, role: 'owner' });

    await expect(
      db.insert(s.orgMemberships).values({ user_id: otherId, org_id: orgId, role: 'owner' })
    ).rejects.toThrow();
  });
});
