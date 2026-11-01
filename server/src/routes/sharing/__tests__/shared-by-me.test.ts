import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture, SYNC_SERVER_URL } from './sharing-fixture.js';

/**
 * You › Sharing: everything the caller has shared, with who has access and
 * the public link, and "Stop sharing" per row.
 */
describe('shared by me (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'Launch plan',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = await f.makeArtifact(workItemId);
    return { author, teammate, workItemId, artifactId };
  }

  it('lists only what the caller shared', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    const quiet = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'Not shared',
      org_id: (await f.as(author.id).get(`/work-items/${workItemId}`)).body.org_id,
    });

    await f.as(author.id).post(`/work-items/${workItemId}/members`, {
      email: teammate.email,
      role: 'edit',
    });
    const opened = await f
      .as(author.id)
      .patch(`/work-items/${workItemId}/artifacts/${artifactId}/general-access`, {
        general_access: 'link',
        general_role: 'view',
      });

    const res = await f.as(author.id).get('/sharing/shared-by-me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'work_item',
          work_item_id: workItemId,
          artifact_id: null,
          name: 'Launch plan',
          general_access: 'invited',
          member_count: 1,
          link_url: null,
        }),
        expect.objectContaining({
          kind: 'artifact',
          work_item_id: workItemId,
          artifact_id: artifactId,
          name: 'plan.md',
          general_access: 'link',
          member_count: 0,
          link_url: opened.body.link.url,
        }),
      ])
    );
    expect(String(opened.body.link.url).startsWith(SYNC_SERVER_URL)).toBe(true);
    expect(res.body.map((row: { work_item_id: string }) => row.work_item_id)).not.toContain(
      quiet.body.id
    );

    const theirs = await f.as(teammate.id).get('/sharing/shared-by-me');
    expect(theirs.body).toEqual([]);
  });

  it('stops sharing a work item: members removed, back to only the author', async () => {
    const { author, teammate, workItemId } = await setup();
    await f.as(author.id).post(`/work-items/${workItemId}/members`, {
      email: teammate.email,
      role: 'edit',
    });
    await f.as(author.id).patch(`/work-items/${workItemId}/general-access`, {
      general_access: 'team',
      general_role: 'view',
    });

    expect((await f.as(teammate.id).del(`/work-items/${workItemId}/sharing`)).status).toBe(403);
    expect((await f.as(author.id).del(`/work-items/${workItemId}/sharing`)).status).toBe(204);

    expect((await f.as(teammate.id).get(`/work-items/${workItemId}`)).status).toBe(404);
    const sharing = await f.as(author.id).get(`/work-items/${workItemId}/sharing`);
    expect(sharing.body).toMatchObject({ general_access: 'invited', members: [] });
  });

  it('stops sharing an artifact, revoking its public link', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    const base = `/work-items/${workItemId}/artifacts/${artifactId}`;
    await f.as(author.id).post(`${base}/members`, { email: teammate.email, role: 'view' });
    await f.as(author.id).patch(`${base}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    });

    expect((await f.as(author.id).del(`${base}/sharing`)).status).toBe(204);

    expect((await f.as(teammate.id).get(`/artifacts/${artifactId}`)).status).toBe(404);
    const sharing = await f.as(author.id).get(`${base}/sharing`);
    expect(sharing.body).toMatchObject({ general_access: 'invited', members: [], link: null });
  });
});
