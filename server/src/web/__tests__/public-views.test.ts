import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSharingFixture } from '../../routes/sharing/__tests__/sharing-fixture.js';

/**
 * What a public link (/p/:token) shows under the P6 viewing model
 * (the P6 sharing design §9): a page — web, prototype or
 * mdx — is its latest uploaded view, served verbatim in the sandboxed frame; a
 * document is its latest `manual` or `agent_milestone` version, never live
 * state and never an `auto` version. Turning the link on for a document that
 * has no such version saves one first.
 */
describe('public link views (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

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
      name: `Launch ${contentType}`,
      content_type: contentType,
      render_class: contentType === 'markdown' ? 'document' : 'page',
    });
    const base = `/work-items/${workItemId}/artifacts/${artifactId}`;
    return { author, workItemId, artifactId, base };
  }

  async function makePublic(authorId: string, base: string): Promise<string> {
    const res = await f.as(authorId).patch(`${base}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    });
    expect(res.status).toBe(200);
    return new URL(res.body.link.url as string).pathname;
  }

  function documentState(paragraphs: string[], mdxPath?: string): string {
    const doc = new Y.Doc();
    const nodes: Y.XmlElement[] = paragraphs.map((text) => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText(text)]);
      return paragraph;
    });
    if (mdxPath) {
      const component = new Y.XmlElement('mdxComponent');
      component.setAttribute('data-path', mdxPath);
      nodes.push(component);
    }
    doc.getXmlFragment('default').insert(0, nodes);
    return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  }

  async function writeLiveState(artifactId: string, state: string) {
    await f.db
      .insert(f.s.yjsDocuments)
      .values({ document_name: `artifact-${artifactId}`, state })
      .onConflictDoUpdate({ target: f.s.yjsDocuments.document_name, set: { state } });
  }

  async function versionRows(artifactId: string) {
    const { eq } = await import('drizzle-orm');
    return f.db
      .select()
      .from(f.s.artifactVersions)
      .where(eq(f.s.artifactVersions.artifact_id, artifactId))
      .orderBy(f.s.artifactVersions.version_number);
  }

  for (const contentType of ['web', 'prototype', 'mdx'] as const) {
    it(`serves a ${contentType} page as its latest view in the sandboxed frame`, async () => {
      const { author, base } = await setup(contentType);
      for (const n of [1, 2]) {
        const res = await f.as(author.id).post(`${base}/versions`, {
          content: `SOURCE ${n}`,
          view_html: `<!doctype html><h1>view ${n}</h1><script>document.title = "ran"</script>`,
        });
        expect(res.status).toBe(201);
      }
      const path = await makePublic(author.id, base);

      const host = await f.anonymous().get(path);
      expect(host.status).toBe(200);
      expect(host.text).toContain(`<iframe sandbox="allow-scripts" src="${path}/frame"`);

      const frame = await f.anonymous().get(`${path}/frame`);
      expect(frame.status).toBe(200);
      expect(frame.text).toBe(
        '<!doctype html><h1>view 2</h1><script>document.title = "ran"</script>'
      );
      expect(frame.text).not.toContain('SOURCE');
      const csp = frame.headers.get('content-security-policy') ?? '';
      expect(csp).toContain('sandbox allow-scripts');
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).not.toContain('allow-same-origin');

      const content = await f.anonymous().get(`${path}/content`);
      expect(content.body).toMatchObject({ frame_path: `${path}/frame`, unavailable_reason: null });
    });
  }

  it('says a page with no view is not published yet, and serves no frame', async () => {
    const { author, artifactId, base } = await setup('web');
    // Source-only version from before views existed.
    await f.db.insert(f.s.artifactVersions).values({
      id: randomUUID(),
      artifact_id: artifactId,
      document_name: `artifact-${artifactId}`,
      version_number: 1,
      trigger: 'manual',
      content: '<h1>SOURCE</h1>',
    });
    const path = await makePublic(author.id, base);

    const host = await f.anonymous().get(path);
    expect(host.status).toBe(200);
    expect(host.text).toMatch(/not published yet/i);
    expect(host.text).not.toContain('<iframe');
    expect((await f.anonymous().get(`${path}/frame`)).status).toBe(404);
  });

  it('saves a "Public link created" version when a document without one goes public', async () => {
    const { author, workItemId, artifactId, base } = await setup('markdown');
    await writeLiveState(artifactId, documentState(['Draft one']));
    const room = f.watchRoom(`work_item:${workItemId}`);

    await makePublic(author.id, base);

    const versions = await versionRows(artifactId);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      trigger: 'manual',
      label: 'Public link created',
      author_id: author.id,
    });
    const events = room.filter((e) => e.type === 'artifact_version_created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: { version_id: versions[0]!.id, trigger: 'manual', has_view: false },
    });

    // Going public again with a published version saves nothing more.
    await f.as(author.id).patch(`${base}/general-access`, {
      general_access: 'invited',
      general_role: 'view',
    });
    await makePublic(author.id, base);
    expect(await versionRows(artifactId)).toHaveLength(1);
  });

  it('does not save a version on going public when a manual or milestone version exists', async () => {
    const { author, artifactId, base } = await setup('markdown');
    await writeLiveState(artifactId, documentState(['Agent draft']));
    const milestone = await f.as(author.id).post(`${base}/versions`, {
      trigger: 'agent_milestone',
    });
    expect(milestone.status).toBe(201);

    await makePublic(author.id, base);
    expect((await versionRows(artifactId)).map((v) => v.trigger)).toEqual(['agent_milestone']);
  });

  it('shows a document’s latest published version, never live edits or auto versions', async () => {
    const { author, artifactId, base } = await setup('markdown');
    await writeLiveState(artifactId, documentState(['Draft one']));
    const path = await makePublic(author.id, base);

    // Live edits since, and an automatic snapshot of them.
    const later = documentState(['Draft two']);
    await writeLiveState(artifactId, later);
    const autoId = randomUUID();
    await f.db.insert(f.s.artifactVersions).values({
      id: autoId,
      artifact_id: artifactId,
      document_name: `artifact-${artifactId}`,
      version_number: 2,
      trigger: 'auto',
    });
    await f.db.insert(f.s.artifactVersionSnapshots).values({ version_id: autoId, snapshot: later });

    const published = await f.anonymous().get(path);
    expect(published.status).toBe(200);
    expect(published.text).toContain('Draft one');
    expect(published.text).not.toContain('Draft two');
    const content = await f.anonymous().get(`${path}/content`);
    expect(content.body.html).toContain('Draft one');
    expect(content.body.html).not.toContain('Draft two');

    // A manual save publishes the live state; an agent milestone after it wins.
    expect((await f.as(author.id).post(`${base}/versions`, {})).status).toBe(201);
    expect((await f.anonymous().get(path)).text).toContain('Draft two');

    await writeLiveState(artifactId, documentState(['Draft three']));
    expect(
      (await f.as(author.id).post(`${base}/versions`, { trigger: 'agent_milestone' })).status
    ).toBe(201);
    const latest = await f.anonymous().get(path);
    expect(latest.text).toContain('Draft three');
    expect(latest.text).not.toContain('Draft two');
  });

  it('renders an embedded interactive component as an escaped note', async () => {
    const { author, artifactId, base } = await setup('markdown');
    await writeLiveState(
      artifactId,
      documentState(['Before the chart'], '/Users/me/private "repo"/chart.mdx')
    );
    const path = await makePublic(author.id, base);

    const res = await f.anonymous().get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Before the chart');
    expect(res.text).toContain('<p class="note">Interactive component — open it in Chord</p>');
    expect(res.text).not.toContain('private');
    expect(res.text).not.toContain('chart.mdx');
    expect(res.text).not.toContain('mdx-component');
  });
});
