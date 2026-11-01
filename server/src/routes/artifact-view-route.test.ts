import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * GET /work-items/:wid/artifacts/:aid/view[?version_id=] — how everyone but
 * the author sees a page (the P6 sharing design §9): the
 * self-contained view uploaded with the latest version that still has one.
 * Gated per artifact, so a person the artifact alone was shared with reads it
 * without reaching the work item.
 */
describe('GET …/view (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const reader = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [reader.id]);
    await f.makeTeam(outsider.id, []);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const pageId = randomUUID();
    await f.db.insert(f.s.artifacts).values({
      id: pageId,
      work_item_id: workItemId,
      name: 'index.html',
      content_type: 'web',
      render_class: 'page',
    });
    const base = `/work-items/${workItemId}/artifacts/${pageId}`;
    return { author, reader, outsider, workItemId, pageId, base };
  }

  async function saveVersion(authorId: string, base: string, n: number, trigger = 'manual') {
    const res = await f.as(authorId).post(`${base}/versions`, {
      content: `<p>source ${n}</p>`,
      view_html: `<p>view ${n}</p>`,
      trigger,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; created_at: string };
  }

  async function nameUser(userId: string, name: string | null) {
    await f.db.update(f.s.users).set({ name }).where(eq(f.s.users.id, userId));
  }

  it('gives the author the latest view with its version metadata', async () => {
    const { author, base } = await setup();
    await nameUser(author.id, 'Ana Author');
    await saveVersion(author.id, base, 1);
    const second = await saveVersion(author.id, base, 2, 'agent_milestone');

    const res = await f.as(author.id).get(`${base}/view`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version_id: second.id,
      version_number: 2,
      trigger: 'agent_milestone',
      author_name: 'Ana Author',
      created_at: second.created_at,
      html: '<p>view 2</p>',
    });
  });

  it('serves a named version, and no_view for one whose view was not kept', async () => {
    const { author, base } = await setup();
    const first = await saveVersion(author.id, base, 1);
    const second = await saveVersion(author.id, base, 2);
    for (let n = 3; n <= 11; n++) await saveVersion(author.id, base, n);

    // Version 1 is now outside the newest 10: its view row is gone.
    const pruned = await f.as(author.id).get(`${base}/view?version_id=${first.id}`);
    expect(pruned.status).toBe(404);
    expect(pruned.body).toEqual({ error: 'no_view' });

    const named = await f.as(author.id).get(`${base}/view?version_id=${second.id}`);
    expect(named.status).toBe(200);
    expect(named.body).toMatchObject({ version_id: second.id, version_number: 2 });
    expect(named.body.html).toBe('<p>view 2</p>');
  });

  // devstation-ale: "saved just now by asha@example.com" where the rest of
  // the app says "Asha Rao". A version names its saver as people are
  // named everywhere else — their profile name, read when the version is —
  // and by the email it was saved under only for an account without one.
  it('names the saver by their profile name, in the view and the version list', async () => {
    const { author, base } = await setup();
    await nameUser(author.id, 'Ana Author');
    await saveVersion(author.id, base, 1);

    const view = await f.as(author.id).get(`${base}/view`);
    const list = await f.as(author.id).get(`${base}/versions`);

    expect(view.body.author_name).toBe('Ana Author');
    expect(list.status).toBe(200);
    expect(list.body.map((v: { author_name: string }) => v.author_name)).toEqual(['Ana Author']);
  });

  it('names a saver without a profile name by the email the version was saved under', async () => {
    const { author, base } = await setup();
    await nameUser(author.id, null);
    await saveVersion(author.id, base, 1);

    const view = await f.as(author.id).get(`${base}/view`);

    expect(view.body.author_name).toBe(author.email);
  });

  it('skips a newer version that has no view', async () => {
    const { author, pageId, base } = await setup();
    const withView = await saveVersion(author.id, base, 1);
    // A version stored before views existed (0017): source only.
    await f.db.insert(f.s.artifactVersions).values({
      id: randomUUID(),
      artifact_id: pageId,
      document_name: `artifact-${pageId}`,
      version_number: 2,
      trigger: 'manual',
      content: '<p>legacy</p>',
    });

    const res = await f.as(author.id).get(`${base}/view`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version_id: withView.id, html: '<p>view 1</p>' });
  });

  it('lets a person the artifact alone was shared with read the view', async () => {
    const { author, reader, workItemId, base } = await setup();
    await saveVersion(author.id, base, 1);
    const added = await f.as(author.id).post(`${base}/members`, {
      email: reader.email,
      role: 'view',
    });
    expect(added.status).toBe(201);

    const res = await f.as(reader.id).get(`${base}/view`);
    expect(res.status).toBe(200);
    expect(res.body.html).toBe('<p>view 1</p>');
    expect((await f.as(reader.id).get(`/work-items/${workItemId}`)).status).toBe(404);
  });

  it('answers 404 to someone without access, never revealing the view', async () => {
    const { author, outsider, reader, base } = await setup();
    await saveVersion(author.id, base, 1);

    for (const caller of [outsider, reader]) {
      const res = await f.as(caller.id).get(`${base}/view`);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('view 1');
    }
  });

  it('answers no_view for a page with no version and for a document', async () => {
    const { author, workItemId, base } = await setup();
    const empty = await f.as(author.id).get(`${base}/view`);
    expect(empty.status).toBe(404);
    expect(empty.body).toEqual({ error: 'no_view' });

    const docId = await f.makeArtifact(workItemId);
    const doc = await f.as(author.id).get(`/work-items/${workItemId}/artifacts/${docId}/view`);
    expect(doc.status).toBe(404);
    expect(doc.body).toEqual({ error: 'no_view' });
  });

  it('never serves another artifact’s version through version_id', async () => {
    const first = await setup();
    const other = await setup();
    const foreign = await saveVersion(other.author.id, other.base, 1);
    await saveVersion(first.author.id, first.base, 1);

    const res = await f.as(first.author.id).get(`${first.base}/view?version_id=${foreign.id}`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('view 1');
  });
});
