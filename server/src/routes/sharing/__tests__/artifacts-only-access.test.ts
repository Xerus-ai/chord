import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * Shared-items step 3 (H1): someone an artifact was shared with alone sees
 * its work item's header (name, repo, owner) and those artifacts, and is told
 * 403 where the work item itself begins: chat, git state, sessions. Someone
 * with no access at all still gets 404: a private item stays invisible.
 * Clients opt in with `?include=artifacts`; older ones keep today's answers.
 */
describe('artifact-only access (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const stranger = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const makeItem = async (name: string) =>
      (await f.as(author.id).post('/work-items', { id: randomUUID(), name, org_id: orgId })).body
        .id as string;
    const artifactOnlyItem = await makeItem('Landing page copy');
    const sharedArtifact = await f.makeArtifact(artifactOnlyItem);
    const unsharedArtifact = await f.makeArtifact(artifactOnlyItem);
    const memberItem = await makeItem('Pricing');
    const teamArtifactItem = await makeItem('Roadmap');
    const teamArtifact = await f.makeArtifact(teamArtifactItem);
    const linkArtifactItem = await makeItem('Press kit');
    const linkArtifact = await f.makeArtifact(linkArtifactItem);

    const author$ = f.as(author.id);
    expect(
      (
        await author$.post(`/work-items/${artifactOnlyItem}/artifacts/${sharedArtifact}/members`, {
          email: teammate.email,
          role: 'view',
        })
      ).status
    ).toBe(201);
    expect(
      (
        await author$.post(`/work-items/${memberItem}/members`, {
          email: teammate.email,
          role: 'edit',
        })
      ).status
    ).toBe(201);
    expect(
      (
        await author$.patch(
          `/work-items/${teamArtifactItem}/artifacts/${teamArtifact}/general-access`,
          {
            general_access: 'team',
            general_role: 'view',
          }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await author$.patch(
          `/work-items/${linkArtifactItem}/artifacts/${linkArtifact}/general-access`,
          {
            general_access: 'link',
            general_role: 'view',
          }
        )
      ).status
    ).toBe(200);
    return {
      author,
      teammate,
      stranger,
      artifactOnlyItem,
      sharedArtifact,
      unsharedArtifact,
      memberItem,
      teamArtifactItem,
      teamArtifact,
      linkArtifactItem,
    };
  }

  it('lists artifact-only items with their artifacts when asked, beside the shared items', async () => {
    const s = await setup();
    const rows = (await f.as(s.teammate.id).get('/work-items/shared-with-me?include=artifacts'))
      .body as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(s.memberItem)).toMatchObject({
      access_scope: 'work_item',
      name: 'Pricing',
      creator_id: s.author.id,
      creator_name: s.author.id.slice(0, 4),
      creator_email: s.author.email,
    });
    const artifactOnly = byId.get(s.artifactOnlyItem);
    expect(artifactOnly).toMatchObject({
      access_scope: 'artifacts',
      name: 'Landing page copy',
      creator_id: s.author.id,
      creator_name: s.author.id.slice(0, 4),
      shared_artifacts: [{ id: s.sharedArtifact, name: 'plan.md' }],
    });
    // A header, not the work item: nothing that belongs to its chat or agent.
    expect(artifactOnly).not.toHaveProperty('sessions');
    expect(artifactOnly).not.toHaveProperty('worktrees');
    expect(artifactOnly).not.toHaveProperty('caller_role');
    expect(byId.get(s.teamArtifactItem)).toMatchObject({
      access_scope: 'artifacts',
      shared_artifacts: [{ id: s.teamArtifact, name: 'plan.md' }],
    });
    // A public link is for people outside the team (design D2): it shares nothing.
    expect(byId.has(s.linkArtifactItem)).toBe(false);
  });

  it('keeps the old listing for clients that do not ask', async () => {
    const s = await setup();
    const rows = (await f.as(s.teammate.id).get('/work-items/shared-with-me')).body as Array<{
      id: string;
    }>;
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(s.memberItem);
    expect(ids).not.toContain(s.artifactOnlyItem);
  });

  it('answers the header of an artifact-only item, and only when asked', async () => {
    const s = await setup();
    const me = f.as(s.teammate.id);
    const header = await me.get(`/work-items/${s.artifactOnlyItem}?include=artifacts`);
    expect(header.status).toBe(200);
    expect(header.body).toMatchObject({
      id: s.artifactOnlyItem,
      access_scope: 'artifacts',
      shared_artifacts: [{ id: s.sharedArtifact, name: 'plan.md' }],
      creator_name: s.author.id.slice(0, 4),
    });
    expect(header.body).not.toHaveProperty('sessions');
    expect((await me.get(`/work-items/${s.artifactOnlyItem}`)).status).toBe(404);
  });

  it('refuses the work item itself with 403 ARTIFACTS_ONLY, and a stranger with 404', async () => {
    const s = await setup();
    for (const path of ['messages', 'git-state', 'sessions']) {
      const refused = await f.as(s.teammate.id).get(`/work-items/${s.artifactOnlyItem}/${path}`);
      expect(refused.status, path).toBe(403);
      expect(refused.body.code, path).toBe('ARTIFACTS_ONLY');
      const hidden = await f.as(s.stranger.id).get(`/work-items/${s.artifactOnlyItem}/${path}`);
      expect(hidden.status, path).toBe(404);
    }
  });

  it('lists only the artifacts shared alone, not the rest of the work item', async () => {
    const s = await setup();
    const listed = await f.as(s.teammate.id).get(`/work-items/${s.artifactOnlyItem}/artifacts`);
    expect(listed.status).toBe(200);
    expect(listed.body.map((a: { id: string }) => a.id)).toEqual([s.sharedArtifact]);
  });

  it('leaves a work-item member as before', async () => {
    const s = await setup();
    const me = f.as(s.teammate.id);
    expect((await me.get(`/work-items/${s.memberItem}/messages`)).status).toBe(200);
    const item = await me.get(`/work-items/${s.memberItem}?include=artifacts`);
    expect(item.body).toMatchObject({ access_scope: 'work_item', caller_role: 'edit' });
  });
});
