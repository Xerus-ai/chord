import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * Shared-items step 3 (H3a): the Share dialog's "People with access" for a
 * whole work item also names the people only some of its artifacts were
 * shared with, and which ones ("1 artifact"). Only the owner reads them:
 * the same state feeds everyone's mention roster, and an artifact-only
 * member must never be offered for a chat they cannot see.
 */
describe('GET /sharing lists artifact-only members (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const alone = await f.makeUser();
    const member = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [alone.id, member.id]);
    const workItemId = (
      await f.as(author.id).post('/work-items', { id: randomUUID(), name: 'item', org_id: orgId })
    ).body.id as string;
    const spec = await f.makeArtifact(workItemId);
    const hero = await f.makeArtifact(workItemId);
    const share = (path: string, email: string, role: 'view' | 'edit') =>
      f.as(author.id).post(`/work-items/${workItemId}${path}/members`, { email, role });
    expect((await share(`/artifacts/${spec}`, alone.email, 'view')).status).toBe(201);
    expect((await share(`/artifacts/${hero}`, alone.email, 'edit')).status).toBe(201);
    expect((await share('', member.email, 'edit')).status).toBe(201);
    // Someone on the work item is listed with it, not again for an artifact.
    expect((await share(`/artifacts/${spec}`, member.email, 'edit')).status).toBe(201);
    return { author, alone, member, workItemId, spec, hero };
  }

  it('tells the owner who holds only artifacts, and which', async () => {
    const s = await setup();
    const state = await f.as(s.author.id).get(`/work-items/${s.workItemId}/sharing`);
    expect(state.status).toBe(200);
    expect(state.body.members.map((m: { user_id: string }) => m.user_id)).toEqual([s.member.id]);
    expect(state.body.artifact_members).toEqual([
      {
        user_id: s.alone.id,
        email: s.alone.email,
        name: s.alone.id.slice(0, 4),
        avatar_url: null,
        pending: false,
        artifacts: [
          {
            member_id: expect.any(String),
            artifact_id: s.spec,
            artifact_name: 'plan.md',
            role: 'view',
          },
          {
            member_id: expect.any(String),
            artifact_id: s.hero,
            artifact_name: 'plan.md',
            role: 'edit',
          },
        ],
      },
    ]);
  });

  it('names the item\'s team, for the invite roster and "Everyone in {team}"', async () => {
    const s = await setup();
    const state = await f.as(s.author.id).get(`/work-items/${s.workItemId}/sharing`);
    expect(state.body.team).toEqual({ id: expect.any(String), name: 'team' });
  });

  it('tells nobody else', async () => {
    const s = await setup();
    const state = await f.as(s.member.id).get(`/work-items/${s.workItemId}/sharing`);
    expect(state.status).toBe(200);
    expect(state.body.artifact_members).toEqual([]);
  });
});
