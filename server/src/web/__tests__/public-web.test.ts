import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSharingFixture } from '../../routes/sharing/__tests__/sharing-fixture.js';

/**
 * The web surface of P6: a public artifact link opens signed out, read-only,
 * sandboxed, with a real OpenGraph card; it stops the moment the link is
 * revoked, the artifact leaves "Anyone with the link" or the team turns public
 * links off. Team links hand off to the desktop app and never leak a title.
 */
describe('public web surface (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup(kind: 'document' | 'page') {
    const author = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, []);
    await f.makeTeam(outsider.id, []);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'Secret project',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = randomUUID();
    await f.db.insert(f.s.artifacts).values({
      id: artifactId,
      work_item_id: workItemId,
      name: kind === 'page' ? 'Launch <page>' : 'Launch plan',
      content_type: kind === 'page' ? 'web' : 'markdown',
      render_class: kind,
    });
    return { author, outsider, orgId, workItemId, artifactId };
  }

  async function makePublic(authorId: string, workItemId: string, artifactId: string) {
    const res = await f
      .as(authorId)
      .patch(`/work-items/${workItemId}/artifacts/${artifactId}/general-access`, {
        general_access: 'link',
        general_role: 'view',
      });
    expect(res.status).toBe(200);
    const url = new URL(res.body.link.url as string);
    return { path: url.pathname, token: url.pathname.split('/p/')[1]! };
  }

  async function storeDocument(artifactId: string) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', '2');
    heading.insert(0, [new Y.XmlText('Goals')]);
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'Ship it ');
    text.insert(8, 'now', { bold: true });
    // Explicit empty attributes: Yjs otherwise carries the preceding bold over.
    text.insert(11, ' <script>alert(1)</script>', {});
    paragraph.insert(0, [text]);
    fragment.insert(0, [heading, paragraph]);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    await f.db.insert(f.s.yjsDocuments).values({ document_name: `artifact-${artifactId}`, state });
  }

  it('renders a public document signed out, escaped, with an OpenGraph card', async () => {
    const { author, workItemId, artifactId } = await setup('document');
    await storeDocument(artifactId);
    const { path } = await makePublic(author.id, workItemId, artifactId);

    const res = await f.anonymous().get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.text).toContain('<h2>Goals</h2>');
    expect(res.text).toContain('<strong>now</strong>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('<meta property="og:title" content="Launch plan"');
    expect(res.text).toContain('<meta property="og:description" content="Goals Ship it now');
    expect(res.text).toContain(`<meta property="og:url" content="https://chord.test${path}"`);
    expect(res.text).not.toContain('Secret project');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('serves a public page from its latest version’s view inside the sandboxed frame', async () => {
    const { author, workItemId, artifactId } = await setup('page');
    for (const view of ['<h1>old</h1>', '<h1>new</h1><script>document.title = "ran"</script>']) {
      const saved = await f
        .as(author.id)
        .post(`/work-items/${workItemId}/artifacts/${artifactId}/versions`, {
          content: '<h1>page source</h1>',
          view_html: view,
        });
      expect(saved.status).toBe(201);
    }
    const { path } = await makePublic(author.id, workItemId, artifactId);

    const host = await f.anonymous().get(path);
    expect(host.status).toBe(200);
    expect(host.text).toContain(`<iframe sandbox="allow-scripts" src="${path}/frame"`);
    expect(host.text).toContain('<title>Launch &lt;page&gt;</title>');

    const frame = await f.anonymous().get(`${path}/frame`);
    expect(frame.status).toBe(200);
    expect(frame.text).toContain('<h1>new</h1><script>document.title = "ran"</script>');
    const csp = frame.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('allow-same-origin');
  });

  it('answers 404 for an unknown token and records every open', async () => {
    const { author, workItemId, artifactId } = await setup('document');
    await storeDocument(artifactId);
    const { path } = await makePublic(author.id, workItemId, artifactId);

    expect((await f.anonymous().get('/p/not-a-real-token')).status).toBe(404);
    await f.anonymous().get(path);

    const { and, eq } = await import('drizzle-orm');
    const opens = await f.db
      .select()
      .from(f.s.accessEvents)
      .where(
        and(
          eq(f.s.accessEvents.artifact_id, artifactId),
          eq(f.s.accessEvents.action, 'link_opened')
        )
      );
    expect(opens).toHaveLength(1);
  });

  it('stops working when the team turns public links off, and when access narrows', async () => {
    const { author, orgId, workItemId, artifactId } = await setup('document');
    await storeDocument(artifactId);
    const { path } = await makePublic(author.id, workItemId, artifactId);

    await f.as(author.id).patch(`/organizations/${orgId}/sharing-policy`, {
      allow_public_links: false,
    });
    expect((await f.anonymous().get(path)).status).toBe(404);
    expect((await f.anonymous().get(`${path}/content`)).status).toBe(404);

    await f.as(author.id).patch(`/organizations/${orgId}/sharing-policy`, {
      allow_public_links: true,
    });
    expect((await f.anonymous().get(path)).status).toBe(200);

    await f
      .as(author.id)
      .patch(`/work-items/${workItemId}/artifacts/${artifactId}/general-access`, {
        general_access: 'team',
        general_role: 'view',
      });
    expect((await f.anonymous().get(path)).status).toBe(404);
  });

  it('gives the desktop the content and lets signed-in non-members comment', async () => {
    const { author, outsider, workItemId, artifactId } = await setup('document');
    await storeDocument(artifactId);
    const { path, token } = await makePublic(author.id, workItemId, artifactId);

    const content = await f.anonymous().get(`${path}/content`);
    expect(content.status).toBe(200);
    expect(content.body).toMatchObject({
      name: 'Launch plan',
      render_class: 'document',
      comments_enabled: true,
    });
    expect(content.body.html).toContain('<h2>Goals</h2>');

    expect(
      (await f.anonymous().post(`/public-links/${token}/comments`, { body: 'hi' })).status
    ).toBe(401);
    const posted = await f
      .as(outsider.id)
      .post(`/public-links/${token}/comments`, { body: 'Looks great' });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({ author_id: outsider.id, body: 'Looks great' });
    const listed = await f.as(outsider.id).get(`/public-links/${token}/comments`);
    expect(listed.body.map((c: { body: string }) => c.body)).toContain('Looks great');

    await f
      .as(author.id)
      .patch(`/work-items/${workItemId}/artifacts/${artifactId}/link`, { comments_enabled: false });
    const refused = await f
      .as(outsider.id)
      .post(`/public-links/${token}/comments`, { body: 'again' });
    expect(refused.status).toBe(403);

    expect(
      (await f.as(outsider.id).get(`/work-items/${workItemId}/artifacts/${artifactId}/comments`))
        .status
    ).toBe(404);
  });

  it('hands team links to the desktop without revealing what they point at', async () => {
    const { workItemId, artifactId } = await setup('document');

    for (const path of [`/open/work-item/${workItemId}`, `/open/artifact/${artifactId}`]) {
      const res = await f.anonymous().get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain(`chord://open/${path.slice('/open/'.length)}`);
      expect(res.text).toContain('<meta property="og:title" content="Chord"');
      expect(res.text).not.toContain('Secret project');
      expect(res.text).not.toContain('Launch plan');
    }
    expect((await f.anonymous().get('/open/work-item/not a uuid')).status).toBe(404);
  });
});
