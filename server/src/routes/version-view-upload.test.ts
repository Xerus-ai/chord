import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * POST /work-items/:wid/artifacts/:aid/versions under the P6 viewing model
 * (the P6 sharing design §9): a page version carries the
 * self-contained HTML view the author's app built, uploads are idempotent on
 * client_version_id (the desktop's sync_queue retries), views are capped at
 * 8 MiB and kept for the newest 10 versions, and every stored version is
 * announced to the work-item and artifact rooms.
 */
describe('POST …/versions with a view (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  const MiB = 1024 * 1024;

  async function setup(contentType: 'web' | 'prototype' | 'mdx' | 'markdown') {
    const author = await f.makeUser();
    const orgId = await f.makeTeam(author.id, []);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = randomUUID();
    await f.db.insert(f.s.artifacts).values({
      id: artifactId,
      work_item_id: workItemId,
      name: `artifact.${contentType}`,
      content_type: contentType,
      render_class: contentType === 'markdown' ? 'document' : 'page',
    });
    const versionsPath = `/work-items/${workItemId}/artifacts/${artifactId}/versions`;
    return { author, workItemId, artifactId, versionsPath };
  }

  async function versionRows(artifactId: string) {
    const { eq } = await import('drizzle-orm');
    return f.db
      .select()
      .from(f.s.artifactVersions)
      .where(eq(f.s.artifactVersions.artifact_id, artifactId))
      .orderBy(f.s.artifactVersions.version_number);
  }

  async function viewRows(artifactId: string) {
    const { eq } = await import('drizzle-orm');
    return f.db
      .select({
        version_id: f.s.artifactVersionViews.version_id,
        version_number: f.s.artifactVersions.version_number,
        html: f.s.artifactVersionViews.html,
        byte_size: f.s.artifactVersionViews.byte_size,
      })
      .from(f.s.artifactVersionViews)
      .innerJoin(
        f.s.artifactVersions,
        eq(f.s.artifactVersions.id, f.s.artifactVersionViews.version_id)
      )
      .where(eq(f.s.artifactVersions.artifact_id, artifactId))
      .orderBy(f.s.artifactVersions.version_number);
  }

  it('stores a page version with its view past the default body limit and returns the row', async () => {
    const { author, artifactId, versionsPath } = await setup('web');
    // Larger than express.json's 100 KB default: the route carries its own limit.
    const view = `<!doctype html><p>${'ö'.repeat(MiB / 2)}</p>`;

    const res = await f.as(author.id).post(versionsPath, {
      label: 'First',
      content: '<p>source</p>',
      view_html: view,
      client_version_id: 'client-1',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      version_number: 1,
      trigger: 'manual',
      label: 'First',
      client_version_id: 'client-1',
      has_view: true,
    });
    expect(typeof res.body.id).toBe('string');
    expect(res.body).not.toHaveProperty('content');
    expect(res.body).not.toHaveProperty('html');

    const [version] = await versionRows(artifactId);
    expect(version).toMatchObject({ id: res.body.id, content: '<p>source</p>' });
    expect(await viewRows(artifactId)).toEqual([
      {
        version_id: res.body.id,
        version_number: 1,
        html: view,
        byte_size: Buffer.byteLength(view, 'utf8'),
      },
    ]);
  });

  it('answers a repeated client_version_id with the stored row and stores nothing new', async () => {
    const { author, workItemId, artifactId, versionsPath } = await setup('prototype');
    const room = f.watchRoom(`work_item:${workItemId}`);
    const body = {
      content: 'export default () => null',
      view_html: '<p>v1</p>',
      client_version_id: 'client-1',
      base_version: 0,
    };

    const first = await f.as(author.id).post(versionsPath, body);
    expect(first.status).toBe(201);
    // A sync_queue retry of an upload that landed: same id, same stale base.
    const retry = await f.as(author.id).post(versionsPath, body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ id: first.body.id, version_number: 1, has_view: true });

    expect(await versionRows(artifactId)).toHaveLength(1);
    expect(await viewRows(artifactId)).toHaveLength(1);
    expect(room.filter((e) => e.type === 'artifact_version_created')).toHaveLength(1);
  });

  it('stores the agent_milestone trigger and refuses triggers a client cannot send', async () => {
    const { author, artifactId, versionsPath } = await setup('mdx');

    const milestone = await f.as(author.id).post(versionsPath, {
      content: '# Chart',
      view_html: '<p>chart</p>',
      trigger: 'agent_milestone',
    });
    expect(milestone.status).toBe(201);
    expect(milestone.body.trigger).toBe('agent_milestone');

    const auto = await f.as(author.id).post(versionsPath, {
      content: '# Chart',
      view_html: '<p>chart</p>',
      trigger: 'auto',
    });
    expect(auto.status).toBe(400);
    expect((await versionRows(artifactId)).map((v) => v.trigger)).toEqual(['agent_milestone']);
  });

  it('accepts a view of exactly 8 MiB and refuses one byte more with 413', async () => {
    const { author, artifactId, versionsPath } = await setup('web');

    const atCap = await f
      .as(author.id)
      .post(versionsPath, { content: '<p>a</p>', view_html: 'a'.repeat(8 * MiB) });
    expect(atCap.status).toBe(201);

    // 4 Mi two-byte characters plus one: under 8 Mi UTF-16 code units, over
    // 8 MiB of UTF-8 — the cap is on bytes.
    const overCap = await f
      .as(author.id)
      .post(versionsPath, { content: '<p>b</p>', view_html: 'é'.repeat(4 * MiB + 1) });
    expect(overCap.status).toBe(413);

    expect(await versionRows(artifactId)).toHaveLength(1);
    expect(await viewRows(artifactId)).toHaveLength(1);
  });

  it('requires a view for a page and refuses one for a document', async () => {
    const page = await setup('web');
    const noView = await f.as(page.author.id).post(page.versionsPath, { content: '<p>x</p>' });
    expect(noView.status).toBe(400);
    expect(JSON.stringify(noView.body)).toMatch(/view_html/);
    expect(await versionRows(page.artifactId)).toHaveLength(0);

    const doc = await setup('markdown');
    const state = new Y.Doc();
    state.getXmlFragment('default').insert(0, [new Y.XmlText('hello')]);
    await f.db.insert(f.s.yjsDocuments).values({
      document_name: `artifact-${doc.artifactId}`,
      state: Buffer.from(Y.encodeStateAsUpdate(state)).toString('base64'),
    });
    const withView = await f
      .as(doc.author.id)
      .post(doc.versionsPath, { view_html: '<p>not for documents</p>' });
    expect(withView.status).toBe(400);
    expect(JSON.stringify(withView.body)).toMatch(/view_html/);
    expect(await versionRows(doc.artifactId)).toHaveLength(0);
  });

  it('keeps views for the newest 10 versions only, and every version itself', async () => {
    const { author, artifactId, versionsPath } = await setup('web');

    for (let n = 1; n <= 12; n++) {
      const res = await f
        .as(author.id)
        .post(versionsPath, { content: `<p>source ${n}</p>`, view_html: `<p>view ${n}</p>` });
      expect(res.status).toBe(201);
    }

    const versions = await versionRows(artifactId);
    expect(versions.map((v) => v.version_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(versions[0]!.content).toBe('<p>source 1</p>');
    const views = await viewRows(artifactId);
    expect(views.map((v) => v.version_number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(views.at(-1)!.html).toBe('<p>view 12</p>');
  });

  it('announces a page version to the work-item and artifact rooms', async () => {
    const { author, workItemId, artifactId, versionsPath } = await setup('web');
    const workItemRoom = f.watchRoom(`work_item:${workItemId}`);
    const artifactRoom = f.watchRoom(`artifact:${artifactId}`);

    const res = await f
      .as(author.id)
      .post(versionsPath, { content: '<p>s</p>', view_html: '<p>v</p>' });
    expect(res.status).toBe(201);

    const expected = {
      type: 'artifact_version_created',
      payload: {
        work_item_id: workItemId,
        artifact_id: artifactId,
        version_id: res.body.id,
        version_number: 1,
        trigger: 'manual',
        has_view: true,
      },
    };
    for (const room of [workItemRoom, artifactRoom]) {
      const events = room.filter((e) => e.type === 'artifact_version_created');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(expected);
    }
  });

  it('versions a document from its live state as an agent milestone, and announces it without a view', async () => {
    const { author, artifactId, versionsPath } = await setup('markdown');
    const state = new Y.Doc();
    state.getXmlFragment('default').insert(0, [new Y.XmlText('hello')]);
    await f.db.insert(f.s.yjsDocuments).values({
      document_name: `artifact-${artifactId}`,
      state: Buffer.from(Y.encodeStateAsUpdate(state)).toString('base64'),
    });
    const artifactRoom = f.watchRoom(`artifact:${artifactId}`);

    const res = await f
      .as(author.id)
      .post(versionsPath, { trigger: 'agent_milestone', client_version_id: 'doc-1' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      version_number: 1,
      trigger: 'agent_milestone',
      client_version_id: 'doc-1',
      has_view: false,
    });
    expect(await viewRows(artifactId)).toEqual([]);
    const events = artifactRoom.filter((e) => e.type === 'artifact_version_created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: { version_id: res.body.id, trigger: 'agent_milestone', has_view: false },
    });

    const retry = await f
      .as(author.id)
      .post(versionsPath, { trigger: 'agent_milestone', client_version_id: 'doc-1' });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(res.body.id);
    expect(await versionRows(artifactId)).toHaveLength(1);
  });
});
