import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * P6 sharing for work items over the real routes and a real database: private
 * until shared, members with view/edit, "anyone in the team", invites limited
 * to the team (outside emails go through a seat), audit rows.
 */
describe('work item sharing (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    await f.makeTeam(outsider.id, []);
    return { author, teammate, outsider, orgId };
  }

  async function createWorkItem(authorId: string, orgId: string, extra: object = {}) {
    const res = await f.as(authorId).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function invite(authorId: string, workItemId: string, email: string, role: string) {
    return f.as(authorId).post(`/work-items/${workItemId}/members`, { email, role });
  }

  it('keeps a new work item invisible to a teammate', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);

    expect((await f.as(teammate.id).get(`/work-items/${id}`)).status).toBe(404);
    const shared = await f.as(teammate.id).get('/work-items/shared-with-me');
    expect(shared.body.map((w: { id: string }) => w.id)).not.toContain(id);
    expect((await f.as(author.id).get(`/work-items/${id}`)).body.caller_role).toBe('author');
  });

  it('starts a work item as "anyone in the team" when asked, and never as public', async () => {
    const { author, teammate, outsider, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId, { general_access: 'team' });

    const read = await f.as(teammate.id).get(`/work-items/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.caller_role).toBe('view');
    const shared = await f.as(teammate.id).get('/work-items/shared-with-me');
    expect(shared.body.map((w: { id: string }) => w.id)).toContain(id);
    expect((await f.as(outsider.id).get(`/work-items/${id}`)).status).toBe(404);

    const refused = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
      general_access: 'link',
    });
    expect(refused.status).toBe(400);
  });

  it('lets a Can view member read and comment but not edit', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    const artifactId = await f.makeArtifact(id);

    const added = await invite(author.id, id, teammate.email, 'view');
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ user_id: teammate.id, role: 'view', pending: false });

    const me = f.as(teammate.id);
    expect((await me.get(`/work-items/${id}`)).body.caller_role).toBe('view');
    const comment = await me.post(`/work-items/${id}/artifacts/${artifactId}/comments`, {
      body: 'looks good',
    });
    expect(comment.status).toBe(201);
    expect((await me.patch(`/work-items/${id}`, { name: 'renamed' })).status).toBe(403);
    expect(
      (
        await me.post(
          `/work-items/${id}/artifacts/${artifactId}/comments/${comment.body.id}/resolve`
        )
      ).status
    ).toBe(403);
  });

  it('changes a member role and removes a member', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    const added = await invite(author.id, id, teammate.email, 'view');

    const promoted = await f
      .as(author.id)
      .patch(`/work-items/${id}/members/${added.body.id}`, { role: 'edit' });
    expect(promoted.status).toBe(200);
    expect((await f.as(teammate.id).patch(`/work-items/${id}`, { name: 'x' })).status).toBe(200);

    expect((await f.as(author.id).del(`/work-items/${id}/members/${added.body.id}`)).status).toBe(
      204
    );
    expect((await f.as(teammate.id).get(`/work-items/${id}`)).status).toBe(404);
  });

  it('lists the sharing state for anyone with access', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    await invite(author.id, id, teammate.email, 'edit');

    const sharing = await f.as(teammate.id).get(`/work-items/${id}/sharing`);
    expect(sharing.status).toBe(200);
    expect(sharing.body).toMatchObject({
      author: { user_id: author.id, email: author.email },
      general_access: 'invited',
      general_role: 'view',
      team_allows_public_links: true,
    });
    expect(sharing.body.members).toEqual([
      expect.objectContaining({ user_id: teammate.id, email: teammate.email, role: 'edit' }),
    ]);
  });

  it('lets only the author manage sharing', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    await invite(author.id, id, teammate.email, 'edit');

    expect((await invite(teammate.id, id, author.email, 'view')).status).toBe(403);
    expect(
      (
        await f.as(teammate.id).patch(`/work-items/${id}/general-access`, {
          general_access: 'team',
          general_role: 'view',
        })
      ).status
    ).toBe(403);
  });

  it('refuses an email outside the team unless it is added to the team', async () => {
    const { author, outsider, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);

    const signedUp = await invite(author.id, id, outsider.email, 'view');
    expect(signedUp.status).toBe(409);
    expect(signedUp.body.code).toBe('NOT_A_TEAM_MEMBER');

    const unknown = await invite(author.id, id, 'nobody@elsewhere.dev', 'view');
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe('NOT_A_TEAM_MEMBER');
  });

  it('refuses to add a seat past the seat limit, storing nothing', async () => {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id], 2);
    const id = await createWorkItem(author.id, orgId);

    const res = await f.as(author.id).post(`/work-items/${id}/members`, {
      email: 'new-seat@elsewhere.dev',
      role: 'view',
      add_to_team: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SEAT_LIMIT_REACHED');
    const sharing = await f.as(author.id).get(`/work-items/${id}/sharing`);
    expect(sharing.body.members).toEqual([]);
  });

  it('only lets the team owner add a seat', async () => {
    const owner = await f.makeUser();
    const author = await f.makeUser();
    const orgId = await f.makeTeam(owner.id, [author.id]);
    const id = await createWorkItem(author.id, orgId);

    const res = await f.as(author.id).post(`/work-items/${id}/members`, {
      email: 'new-seat@elsewhere.dev',
      role: 'view',
      add_to_team: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TEAM_OWNER_ONLY');
  });

  it('gives "anyone in the team" the chosen role and refuses a public work item', async () => {
    const { author, teammate, outsider, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);

    const edit = await f.as(author.id).patch(`/work-items/${id}/general-access`, {
      general_access: 'team',
      general_role: 'edit',
    });
    expect(edit.status).toBe(200);
    expect((await f.as(teammate.id).get(`/work-items/${id}`)).body.caller_role).toBe('edit');
    expect((await f.as(outsider.id).get(`/work-items/${id}`)).status).toBe(404);

    const link = await f.as(author.id).patch(`/work-items/${id}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    });
    expect(link.status).toBe(400);

    await f.as(author.id).patch(`/work-items/${id}/general-access`, {
      general_access: 'invited',
      general_role: 'view',
    });
    expect((await f.as(teammate.id).get(`/work-items/${id}`)).status).toBe(404);
  });

  it('keeps chat, git state and commands closed to people without work-item access', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    const me = f.as(teammate.id);

    expect((await me.get(`/work-items/${id}/messages`)).status).toBe(404);
    expect((await me.get(`/work-items/${id}/git-state`)).status).toBe(404);
    expect((await me.get(`/work-items/${id}/sessions`)).status).toBe(404);
  });

  it('notifies only people with access when a viewer mentions them', async () => {
    const { author, teammate, outsider, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    await invite(author.id, id, teammate.email, 'view');

    const res = await f.as(teammate.id).post(`/work-items/${id}/mentions`, {
      user_ids: [author.id, outsider.id],
      excerpt: 'see this',
    });
    expect(res.status).toBe(201);
    expect(res.body.notified).toBe(1);
  });

  it('records an audit row for each grant, change and revoke', async () => {
    const { author, teammate, orgId } = await setup();
    const id = await createWorkItem(author.id, orgId);
    const added = await invite(author.id, id, teammate.email, 'view');
    await f.as(author.id).patch(`/work-items/${id}/members/${added.body.id}`, { role: 'edit' });
    await f.as(author.id).del(`/work-items/${id}/members/${added.body.id}`);
    await f.as(author.id).patch(`/work-items/${id}/general-access`, {
      general_access: 'team',
      general_role: 'view',
    });

    const { eq, asc } = await import('drizzle-orm');
    const events = await f.db
      .select({
        action: f.s.accessEvents.action,
        actor_id: f.s.accessEvents.actor_id,
        subject_user_id: f.s.accessEvents.subject_user_id,
        role: f.s.accessEvents.role,
      })
      .from(f.s.accessEvents)
      .where(eq(f.s.accessEvents.work_item_id, id))
      .orderBy(asc(f.s.accessEvents.created_at));
    expect(events).toEqual([
      { action: 'member_added', actor_id: author.id, subject_user_id: teammate.id, role: 'view' },
      {
        action: 'member_role_changed',
        actor_id: author.id,
        subject_user_id: teammate.id,
        role: 'edit',
      },
      { action: 'member_removed', actor_id: author.id, subject_user_id: teammate.id, role: 'edit' },
      {
        action: 'general_access_changed',
        actor_id: author.id,
        subject_user_id: null,
        role: 'view',
      },
    ]);
  });

  it('lets only the team owner change the team sharing policy', async () => {
    const { author, teammate, orgId } = await setup();

    const refused = await f.as(teammate.id).patch(`/organizations/${orgId}/sharing-policy`, {
      allow_public_links: false,
    });
    expect(refused.status).toBe(403);

    const changed = await f.as(author.id).patch(`/organizations/${orgId}/sharing-policy`, {
      allow_public_links: false,
      allow_confluence_publishing: false,
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ allow_public_links: false, allow_confluence_publishing: false });
  });
});
