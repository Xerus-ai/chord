import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * An artifact's comments written on its author's device before the artifact
 * first reached the cloud (devstation-85y). The desktop imports them once the
 * artifact is registered: same ids (so replies keep their parent), same
 * anchors, resolved state and times, attributed to the caller. A retry of the
 * same import adds nothing and changes nothing.
 */
describe('importing an artifact’s device comments (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const viewer = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [viewer.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const shared = await f.as(author.id).post(`/work-items/${workItemId}/members`, {
      email: viewer.email,
      role: 'view',
    });
    expect(shared.status).toBe(201);
    const artifactId = randomUUID();
    const registered = await f.as(author.id).post(`/work-items/${workItemId}/artifacts`, {
      id: artifactId,
      name: 'notes.md',
      content_type: 'markdown',
    });
    expect(registered.status).toBe(201);
    const commentsPath = `/work-items/${workItemId}/artifacts/${artifactId}/comments`;
    return {
      author,
      viewer,
      outsider,
      workItemId,
      artifactId,
      commentsPath,
      importPath: `${commentsPath}/import`,
    };
  }

  const thread = () => {
    const parent = randomUUID();
    return [
      {
        id: parent,
        parent_comment_id: null,
        anchor_key: 'chord-id:h',
        anchor_text: null,
        body: 'the heading',
        resolved: false,
        created_at: '2026-09-29T01:00:00.000Z',
      },
      {
        id: randomUUID(),
        parent_comment_id: parent,
        anchor_key: null,
        anchor_text: null,
        body: 'a reply',
        resolved: false,
        created_at: '2026-09-29T01:00:05.000Z',
      },
      {
        id: randomUUID(),
        parent_comment_id: null,
        anchor_key: null,
        anchor_text: '$24',
        body: 'done already',
        resolved: true,
        created_at: '2026-09-29T01:00:10.000Z',
      },
    ];
  };

  it('keeps ids, parents, anchors, resolved state and times, attributed to the caller', async () => {
    const s = await setup();
    const comments = thread();

    const res = await f.as(s.author.id).post(s.importPath, { comments });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 3 });
    const listed = (await f.as(s.author.id).get(s.commentsPath)).body as Array<
      Record<string, unknown>
    >;
    expect(listed.map((c) => c.id)).toEqual([comments[2].id, comments[1].id, comments[0].id]);
    const byId = new Map(listed.map((c) => [c.id, c]));
    expect(byId.get(comments[1].id)).toMatchObject({
      parent_comment_id: comments[0].id,
      author_id: s.author.id,
      author_name: s.author.email,
      body: 'a reply',
      resolved: false,
    });
    expect(byId.get(comments[0].id)).toMatchObject({ anchor_key: 'chord-id:h' });
    expect(byId.get(comments[2].id)).toMatchObject({
      anchor_text: '$24',
      resolved: true,
      resolved_by: s.author.id,
    });
    expect(new Date(byId.get(comments[0].id)!.created_at as string).toISOString()).toBe(
      '2026-09-29T01:00:00.000Z'
    );

    // The summary the rail reads counts them: two threads, one resolved.
    const summary = await f.as(s.author.id).get(`/work-items/${s.workItemId}/artifact-summary`);
    expect(summary.body).toEqual([
      expect.objectContaining({ artifact_id: s.artifactId, open_comments: 1 }),
    ]);
  });

  it('adds nothing and changes nothing when the same import is retried', async () => {
    const s = await setup();
    const comments = thread();
    expect((await f.as(s.author.id).post(s.importPath, { comments })).status).toBe(200);

    const edited = comments.map((c) => ({ ...c, body: 'rewritten', resolved: true }));
    const extra = { ...comments[0], id: randomUUID(), body: 'written during the retry' };
    const retry = await f.as(s.author.id).post(s.importPath, { comments: [...edited, extra] });

    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ imported: 1 });
    const listed = (await f.as(s.author.id).get(s.commentsPath)).body as Array<
      Record<string, unknown>
    >;
    expect(listed).toHaveLength(4);
    const first = listed.find((c) => c.id === comments[0].id);
    expect(first).toMatchObject({ body: 'the heading', resolved: false });
  });

  it('refuses a viewer, an outsider, and an artifact addressed through another work item', async () => {
    const s = await setup();
    const other = await setup();
    const comments = thread();

    expect((await f.as(s.viewer.id).post(s.importPath, { comments })).status).toBe(403);
    expect((await f.as(s.outsider.id).post(s.importPath, { comments })).status).toBe(404);
    const crossed = await f
      .as(s.author.id)
      .post(`/work-items/${other.workItemId}/artifacts/${s.artifactId}/comments/import`, {
        comments,
      });
    expect(crossed.status).toBe(404);
    expect((await f.as(s.author.id).get(s.commentsPath)).body).toEqual([]);
  });

  it('refuses an empty or malformed import', async () => {
    const s = await setup();

    expect((await f.as(s.author.id).post(s.importPath, { comments: [] })).status).toBe(400);
    const noBody = [{ ...thread()[0], body: '' }];
    expect((await f.as(s.author.id).post(s.importPath, { comments: noBody })).status).toBe(400);
    const badTime = [{ ...thread()[0], created_at: 'yesterday' }];
    expect((await f.as(s.author.id).post(s.importPath, { comments: badTime })).status).toBe(400);
  });
});
