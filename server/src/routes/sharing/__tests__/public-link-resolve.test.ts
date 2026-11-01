import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * A public link opened in the desktop app (shared-items step 4, decision 10):
 * a signed-in caller who can reach the artifact gets its ids, so the app opens
 * it as a tab; anyone else gets the same 404 a bad token gets, so the answer
 * discloses nothing about the link or the artifact.
 */
describe('GET /public-links/:token/resolve (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const reader = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [reader.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = await f.makeArtifact(workItemId);
    const general = `/work-items/${workItemId}/artifacts/${artifactId}/general-access`;
    const opened = await f
      .as(author.id)
      .patch(general, { general_access: 'link', general_role: 'view' });
    expect(opened.status).toBe(200);
    const token = String(opened.body.link.url).split('/p/')[1]!;
    return { author, reader, outsider, workItemId, artifactId, general, token };
  }

  it('gives the author the artifact and its work item', async () => {
    const { author, workItemId, artifactId, token } = await setup();
    const resolved = await f.as(author.id).get(`/public-links/${token}/resolve`);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ artifact_id: artifactId, work_item_id: workItemId });
  });

  it('gives a member the artifact shared with them, even alone', async () => {
    const { author, reader, workItemId, artifactId, token } = await setup();
    const added = await f
      .as(author.id)
      .post(`/work-items/${workItemId}/artifacts/${artifactId}/members`, {
        email: reader.email,
        role: 'view',
      });
    expect(added.status).toBe(201);
    const resolved = await f.as(reader.id).get(`/public-links/${token}/resolve`);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toEqual({ artifact_id: artifactId, work_item_id: workItemId });
  });

  it('answers a caller without access exactly as it answers a bad token', async () => {
    const { outsider, token } = await setup();
    const noAccess = await f.as(outsider.id).get(`/public-links/${token}/resolve`);
    const badToken = await f.as(outsider.id).get(`/public-links/${'x'.repeat(43)}/resolve`);
    expect(noAccess.status).toBe(404);
    expect(badToken.status).toBe(404);
    expect(noAccess.body).toEqual(badToken.body);
  });

  it('answers 404 for a revoked link, to the author too', async () => {
    const { author, general, token } = await setup();
    await f.as(author.id).patch(general, { general_access: 'invited', general_role: 'view' });
    const resolved = await f.as(author.id).get(`/public-links/${token}/resolve`);
    expect(resolved.status).toBe(404);
  });

  it('needs a signed-in caller', async () => {
    const { token } = await setup();
    expect((await f.anonymous().get(`/public-links/${token}/resolve`)).status).toBe(401);
  });
});
