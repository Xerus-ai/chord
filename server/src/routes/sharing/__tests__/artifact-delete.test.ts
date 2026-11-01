import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * Deleting an artifact (P6 ships the Delete action with its confirmation):
 * author only; everything hanging off the artifact goes with it — members,
 * public link, comments, versions, its collaboration document — and an audit
 * row stays behind.
 */
describe('DELETE /work-items/:id/artifacts/:artifact_id (real DB)', () => {
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
      general_access: 'team',
    });
    const workItemId = created.body.id as string;
    const artifactId = await f.makeArtifact(workItemId);
    return { author, teammate, workItemId, artifactId };
  }

  it('refuses anyone but the author', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    await f.as(author.id).patch(`/work-items/${workItemId}/general-access`, {
      general_access: 'team',
      general_role: 'edit',
    });

    const res = await f.as(teammate.id).del(`/work-items/${workItemId}/artifacts/${artifactId}`);
    expect(res.status).toBe(403);
    expect((await f.as(author.id).get(`/artifacts/${artifactId}`)).status).toBe(200);
  });

  it('deletes the artifact with its sharing, comments and document', async () => {
    const { author, teammate, workItemId, artifactId } = await setup();
    const base = `/work-items/${workItemId}/artifacts/${artifactId}`;
    await f.as(author.id).post(`${base}/members`, { email: teammate.email, role: 'view' });
    await f.as(author.id).patch(`${base}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    });
    await f.as(teammate.id).post(`${base}/comments`, { body: 'first' });
    await f.db
      .insert(f.s.yjsDocuments)
      .values({ document_name: `artifact-${artifactId}`, state: '' });

    expect((await f.as(author.id).del(base)).status).toBe(204);

    const { eq } = await import('drizzle-orm');
    expect((await f.as(author.id).get(`/artifacts/${artifactId}`)).status).toBe(404);
    expect(
      await f.db
        .select()
        .from(f.s.resourceMembers)
        .where(eq(f.s.resourceMembers.artifact_id, artifactId))
    ).toEqual([]);
    expect(
      await f.db.select().from(f.s.shareLinks).where(eq(f.s.shareLinks.artifact_id, artifactId))
    ).toEqual([]);
    expect(
      await f.db
        .select()
        .from(f.s.artifactComments)
        .where(eq(f.s.artifactComments.artifact_id, artifactId))
    ).toEqual([]);
    expect(
      await f.db
        .select()
        .from(f.s.yjsDocuments)
        .where(eq(f.s.yjsDocuments.document_name, `artifact-${artifactId}`))
    ).toEqual([]);
    const audit = await f.db
      .select({ action: f.s.accessEvents.action, actor_id: f.s.accessEvents.actor_id })
      .from(f.s.accessEvents)
      .where(eq(f.s.accessEvents.artifact_id, artifactId));
    expect(audit).toContainEqual({ action: 'artifact_deleted', actor_id: author.id });
  });

  it('answers 404 for an artifact that does not exist', async () => {
    const { author, workItemId } = await setup();
    const res = await f.as(author.id).del(`/work-items/${workItemId}/artifacts/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
