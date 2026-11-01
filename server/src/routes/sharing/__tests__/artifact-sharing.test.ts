import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture, SYNC_SERVER_URL } from './sharing-fixture.js';

/**
 * P6 sharing for artifacts: an artifact inherits its work item's access, can
 * be shared alone (which never opens the work item), and can have a public
 * link that the team owner can switch off.
 */
describe('artifact sharing (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = await f.makeArtifact(workItemId);
    return { author, teammate, orgId, workItemId, artifactId };
  }

  function artifactPath(workItemId: string, artifactId: string, rest = ''): string {
    return `/work-items/${workItemId}/artifacts/${artifactId}${rest}`;
  }

  it('opens an artifact shared alone without opening its work item', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();

    const added = await f.as(author.id).post(artifactPath(workItemId, artifactId, '/members'), {
      email: teammate.email,
      role: 'edit',
    });
    expect(added.status).toBe(201);

    const me = f.as(teammate.id);
    const artifact = await me.get(`/artifacts/${artifactId}`);
    expect(artifact.status).toBe(200);
    expect(artifact.body).toMatchObject({
      id: artifactId,
      work_item_id: workItemId,
      caller_role: 'edit',
      work_item_role: null,
    });
    const sharedArtifacts = await me.get('/artifacts/shared-with-me');
    expect(sharedArtifacts.body.map((a: { id: string }) => a.id)).toContain(artifactId);

    expect((await me.get(artifactPath(workItemId, artifactId, '/comments'))).status).toBe(200);
    // Older clients never asked for artifact-only items: they still see none.
    expect((await me.get(`/work-items/${workItemId}`)).status).toBe(404);
    expect((await me.get(`/work-items/${workItemId}/messages`)).status).toBe(403);
    expect((await me.get(`/work-items/${workItemId}/git-state`)).status).toBe(403);
    const listed = await me.get(`/work-items/${workItemId}/artifacts`);
    expect(listed.body.map((a: { id: string }) => a.id)).toEqual([artifactId]);
    const sharedItems = await me.get('/work-items/shared-with-me');
    expect(sharedItems.body.map((w: { id: string }) => w.id)).not.toContain(workItemId);
  });

  it('refuses an artifact addressed through a work item it does not belong to', async () => {
    const { author, orgId, artifactId } = await setup();
    const otherItem = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'other',
      org_id: orgId,
    });

    const res = await f.as(author.id).get(artifactPath(otherItem.body.id, artifactId, '/comments'));
    expect(res.status).toBe(404);
  });

  it('gives work-item members the artifact at their work-item role', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    await f.as(author.id).post(`/work-items/${workItemId}/members`, {
      email: teammate.email,
      role: 'view',
    });

    const artifact = await f.as(teammate.id).get(`/artifacts/${artifactId}`);
    expect(artifact.body).toMatchObject({ caller_role: 'view', work_item_role: 'view' });
    const listed = await f.as(teammate.id).get(`/work-items/${workItemId}/artifacts`);
    expect(listed.body.map((a: { id: string }) => a.id)).toContain(artifactId);
    const sharedArtifacts = await f.as(teammate.id).get('/artifacts/shared-with-me');
    expect(sharedArtifacts.body.map((a: { id: string }) => a.id)).not.toContain(artifactId);
  });

  it('creates a public link for an artifact and revokes it when access narrows', async () => {
    const { author, workItemId, artifactId } = await setup();
    const general = artifactPath(workItemId, artifactId, '/general-access');

    const opened = await f
      .as(author.id)
      .patch(general, { general_access: 'link', general_role: 'view' });
    expect(opened.status).toBe(200);
    expect(opened.body.link.url).toMatch(new RegExp(`^${SYNC_SERVER_URL}/p/[A-Za-z0-9_-]{43}$`));
    expect(opened.body.link.comments_enabled).toBe(true);

    const sharing = await f.as(author.id).get(artifactPath(workItemId, artifactId, '/sharing'));
    expect(sharing.body.link.url).toBe(opened.body.link.url);

    const quiet = await f
      .as(author.id)
      .patch(artifactPath(workItemId, artifactId, '/link'), { comments_enabled: false });
    expect(quiet.status).toBe(200);
    expect(quiet.body.comments_enabled).toBe(false);

    await f.as(author.id).patch(general, { general_access: 'invited', general_role: 'view' });
    const { and, eq, isNull } = await import('drizzle-orm');
    const live = await f.db
      .select()
      .from(f.s.shareLinks)
      .where(and(eq(f.s.shareLinks.artifact_id, artifactId), isNull(f.s.shareLinks.revoked_at)));
    expect(live).toEqual([]);
    const after = await f.as(author.id).get(artifactPath(workItemId, artifactId, '/sharing'));
    expect(after.body.link).toBeNull();
  });

  it('never stores the link token itself', async () => {
    const { author, workItemId, artifactId } = await setup();
    const opened = await f
      .as(author.id)
      .patch(artifactPath(workItemId, artifactId, '/general-access'), {
        general_access: 'link',
        general_role: 'view',
      });
    const token = String(opened.body.link.url).split('/p/')[1]!;

    const { eq } = await import('drizzle-orm');
    const [row] = await f.db
      .select({ token_hash: f.s.shareLinks.token_hash })
      .from(f.s.shareLinks)
      .where(eq(f.s.shareLinks.artifact_id, artifactId));
    expect(row!.token_hash).not.toContain(token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a link that grants edit, and any link while the team has them off', async () => {
    const { author, orgId, workItemId, artifactId } = await setup();
    const general = artifactPath(workItemId, artifactId, '/general-access');

    expect(
      (await f.as(author.id).patch(general, { general_access: 'link', general_role: 'edit' }))
        .status
    ).toBe(400);

    await f
      .as(author.id)
      .patch(`/organizations/${orgId}/sharing-policy`, { allow_public_links: false });
    const refused = await f
      .as(author.id)
      .patch(general, { general_access: 'link', general_role: 'view' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('PUBLIC_LINKS_DISABLED');
    const sharing = await f.as(author.id).get(artifactPath(workItemId, artifactId, '/sharing'));
    expect(sharing.body.team_allows_public_links).toBe(false);
  });

  it('lets a Can view member comment on the artifact but not save a version', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    await f.as(author.id).post(artifactPath(workItemId, artifactId, '/members'), {
      email: teammate.email,
      role: 'view',
    });

    const me = f.as(teammate.id);
    expect(
      (await me.post(artifactPath(workItemId, artifactId, '/comments'), { body: 'hi' })).status
    ).toBe(201);
    expect((await me.post(artifactPath(workItemId, artifactId, '/versions'), {})).status).toBe(403);
  });
});
