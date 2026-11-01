import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type * as AccessCacheNS from './access-cache.js';
import type * as ResolveAccessNS from './resolve-access.js';

/**
 * The one access resolver (P6): work items and artifacts, members, team
 * access, public links, inheritance, and the cache. Real PGlite database with
 * every deployable migration applied.
 */
describe('resolve-access (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');

  let db: Database;
  let s: ServerSchema;
  let resolve: typeof ResolveAccessNS;
  let cache: typeof AccessCacheNS;

  beforeAll(async () => {
    await testDb.start();
    db = (await import('../db/client.js')).db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    resolve = await import('./resolve-access.js');
    cache = await import('./access-cache.js');
  });

  afterAll(async () => {
    await testDb.stop();
  });

  async function makeUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(s.users).values({ id, email: `${id}@test.example.com`, name: id.slice(0, 6) });
    return id;
  }

  async function makeOrg(memberIds: string[]): Promise<string> {
    const id = randomUUID();
    await db.insert(s.organizations).values({ id, name: 'team' });
    for (const userId of memberIds) {
      await db.insert(s.orgMemberships).values({ org_id: id, user_id: userId });
    }
    return id;
  }

  async function makeWorkItem(
    orgId: string,
    creatorId: string,
    general: { general_access?: 'invited' | 'team'; general_role?: 'view' | 'edit' } = {}
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(s.workItems).values({
      id,
      org_id: orgId,
      creator_id: creatorId,
      name: 'item',
      ...general,
    });
    return id;
  }

  async function makeArtifact(
    workItemId: string,
    general: { general_access?: 'invited' | 'team' | 'link'; general_role?: 'view' | 'edit' } = {}
  ): Promise<string> {
    const id = randomUUID();
    await db
      .insert(s.artifacts)
      .values({ id, work_item_id: workItemId, name: 'plan.md', ...general });
    return id;
  }

  async function addMember(
    workItemId: string,
    grantedBy: string,
    target: { userId?: string; email?: string },
    role: 'view' | 'edit',
    artifactId: string | null = null
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(s.resourceMembers).values({
      id,
      work_item_id: workItemId,
      artifact_id: artifactId,
      user_id: target.userId ?? null,
      invited_email: target.email ?? null,
      role,
      granted_by: grantedBy,
    });
    return id;
  }

  /** Two teammates and one outsider; the author's item is invited-only. */
  async function setup() {
    const author = await makeUser();
    const teammate = await makeUser();
    const outsider = await makeUser();
    const orgId = await makeOrg([author, teammate]);
    await makeOrg([outsider]);
    return { author, teammate, outsider, orgId };
  }

  describe('work items', () => {
    it('gives the creator author and a teammate nothing on an invited-only item', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);

      expect(await resolve.resolveWorkItemAccess(author, workItemId)).toMatchObject({
        role: 'author',
        source: 'author',
      });
      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toBeNull();
    });

    it('gives a member exactly their role', async () => {
      const { author, teammate, outsider, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      await addMember(workItemId, author, { userId: teammate }, 'view');
      await addMember(workItemId, author, { userId: outsider }, 'edit');

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toMatchObject({
        role: 'view',
        source: 'member',
      });
      expect(await resolve.resolveWorkItemAccess(outsider, workItemId)).toMatchObject({
        role: 'edit',
        source: 'member',
      });
    });

    it('gives "anyone in the team" to org members only, at the chosen role', async () => {
      const { author, teammate, outsider, orgId } = await setup();
      const viewItem = await makeWorkItem(orgId, author, { general_access: 'team' });
      const editItem = await makeWorkItem(orgId, author, {
        general_access: 'team',
        general_role: 'edit',
      });

      expect(await resolve.resolveWorkItemAccess(teammate, viewItem)).toMatchObject({
        role: 'view',
        source: 'team',
      });
      expect(await resolve.resolveWorkItemAccess(teammate, editItem)).toMatchObject({
        role: 'edit',
        source: 'team',
      });
      expect(await resolve.resolveWorkItemAccess(outsider, viewItem)).toBeNull();
    });

    it('takes the higher of a member role and the team role', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author, {
        general_access: 'team',
        general_role: 'edit',
      });
      await addMember(workItemId, author, { userId: teammate }, 'view');

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toMatchObject({
        role: 'edit',
      });
    });

    it('grants nothing through a pending email invite', async () => {
      const { author, orgId } = await setup();
      const invitee = await makeUser();
      const workItemId = await makeWorkItem(orgId, author);
      await addMember(workItemId, author, { email: `${invitee}@test.example.com` }, 'edit');

      expect(await resolve.resolveWorkItemAccess(invitee, workItemId)).toBeNull();
    });

    it('never reaches the work item through artifact-only access', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId, { general_access: 'team' });
      await addMember(workItemId, author, { userId: teammate }, 'edit', artifactId);

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toBeNull();
    });

    it('answers not_found for an unknown work item', async () => {
      const { author } = await setup();
      expect(await resolve.resolveWorkItemAccess(author, randomUUID())).toBe('not_found');
    });
  });

  describe('artifacts', () => {
    it('inherits the work item role', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId);
      await addMember(workItemId, author, { userId: teammate }, 'view');

      expect(await resolve.resolveArtifactAccess(author, artifactId)).toMatchObject({
        role: 'author',
        work_item_id: workItemId,
        work_item_role: 'author',
      });
      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'view',
        work_item_role: 'view',
      });
    });

    it('opens an artifact shared alone without opening its work item', async () => {
      const { author, outsider, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId);
      await addMember(workItemId, author, { userId: outsider }, 'edit', artifactId);

      expect(await resolve.resolveArtifactAccess(outsider, artifactId)).toMatchObject({
        role: 'edit',
        work_item_role: null,
      });
    });

    it('adds to inherited access and takes the higher role', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId);
      await addMember(workItemId, author, { userId: teammate }, 'view');
      await addMember(workItemId, author, { userId: teammate }, 'edit', artifactId);

      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'edit',
        work_item_role: 'view',
      });
    });

    it('cannot hide from work-item members', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author, { general_access: 'team' });
      const artifactId = await makeArtifact(workItemId, { general_access: 'invited' });

      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'view',
        work_item_role: 'view',
      });
    });

    it('gives team access on the artifact alone to org members only', async () => {
      const { author, teammate, outsider, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId, {
        general_access: 'team',
        general_role: 'edit',
      });

      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'edit',
        work_item_role: null,
      });
      expect(await resolve.resolveArtifactAccess(outsider, artifactId)).toBeNull();
      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toBeNull();
    });

    it('lets team members view a link artifact and grants nobody else access by id', async () => {
      const { author, teammate, outsider, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId, { general_access: 'link' });

      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'view',
        work_item_role: null,
      });
      expect(await resolve.resolveArtifactAccess(outsider, artifactId)).toBeNull();
    });

    it('answers not_found for an unknown artifact', async () => {
      const { author } = await setup();
      expect(await resolve.resolveArtifactAccess(author, randomUUID())).toBe('not_found');
    });
  });

  describe('cache', () => {
    it('serves a cached answer until the work item is invalidated, artifacts included', async () => {
      const { author, teammate, orgId } = await setup();
      const workItemId = await makeWorkItem(orgId, author);
      const artifactId = await makeArtifact(workItemId);
      const memberId = await addMember(workItemId, author, { userId: teammate }, 'edit');

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toMatchObject({
        role: 'edit',
      });
      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toMatchObject({
        role: 'edit',
      });

      const { eq } = await import('drizzle-orm');
      await db.delete(s.resourceMembers).where(eq(s.resourceMembers.id, memberId));

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toMatchObject({
        role: 'edit',
      });

      cache.invalidateWorkItemAccess(workItemId);

      expect(await resolve.resolveWorkItemAccess(teammate, workItemId)).toBeNull();
      expect(await resolve.resolveArtifactAccess(teammate, artifactId)).toBeNull();
    });
  });

  describe('roleAtLeast', () => {
    it('orders view < edit < author', () => {
      expect(resolve.roleAtLeast('author', 'edit')).toBe(true);
      expect(resolve.roleAtLeast('edit', 'edit')).toBe(true);
      expect(resolve.roleAtLeast('view', 'edit')).toBe(false);
      expect(resolve.roleAtLeast('view', 'view')).toBe(true);
    });
  });
});
