import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * Shared-items step 3 (H7): a work item carries its repo's normalized origin
 * (`repo_remote_url`, migration 0022), so a teammate's sidebar can put a shared
 * item in their own group for that repo. The owner's app sends it on create
 * and backfills older items through the ordinary PATCH; the shared-with-me
 * listing hands it to the teammate for both kinds of row.
 */
describe('work item repo_remote_url (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  const REMOTE = 'github.com/acme/chord';

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    return { author, teammate, orgId };
  }

  it('stores the remote the owner sends on create', async () => {
    const { author, orgId } = await setup();
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'With remote',
      org_id: orgId,
      repo_name: 'chord',
      repo_remote_url: REMOTE,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ repo_name: 'chord', repo_remote_url: REMOTE });
  });

  it('leaves it null for a create that sends none (an older desktop build)', async () => {
    const { author, orgId } = await setup();
    const created = await f
      .as(author.id)
      .post('/work-items', { id: randomUUID(), name: 'Old client', org_id: orgId });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ repo_remote_url: null });
  });

  it('backfills it onto an existing item through PATCH', async () => {
    const { author, orgId } = await setup();
    const id = (
      await f.as(author.id).post('/work-items', { id: randomUUID(), name: 'Before', org_id: orgId })
    ).body.id as string;
    const patched = await f.as(author.id).patch(`/work-items/${id}`, { repo_remote_url: REMOTE });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ repo_remote_url: REMOTE });
    expect((await f.as(author.id).get(`/work-items/${id}`)).body).toMatchObject({
      repo_remote_url: REMOTE,
    });
  });

  it('hands it to the teammate on both kinds of shared-with-me row', async () => {
    const { author, teammate, orgId } = await setup();
    const author$ = f.as(author.id);
    const makeItem = async (name: string) =>
      (
        await author$.post('/work-items', {
          id: randomUUID(),
          name,
          org_id: orgId,
          repo_name: 'chord',
          repo_remote_url: REMOTE,
        })
      ).body.id as string;
    const memberItem = await makeItem('Shared whole');
    const artifactItem = await makeItem('Shared artifact');
    const artifact = await f.makeArtifact(artifactItem);
    expect(
      (
        await author$.post(`/work-items/${memberItem}/members`, {
          email: teammate.email,
          role: 'view',
        })
      ).status
    ).toBe(201);
    expect(
      (
        await author$.post(`/work-items/${artifactItem}/artifacts/${artifact}/members`, {
          email: teammate.email,
          role: 'view',
        })
      ).status
    ).toBe(201);

    const rows = (await f.as(teammate.id).get('/work-items/shared-with-me?include=artifacts'))
      .body as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(memberItem)).toMatchObject({
      access_scope: 'work_item',
      repo_remote_url: REMOTE,
    });
    expect(byId.get(artifactItem)).toMatchObject({
      access_scope: 'artifacts',
      repo_remote_url: REMOTE,
    });
  });
});
