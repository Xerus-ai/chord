import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from '../../routes/sharing/__tests__/sharing-fixture.js';

/**
 * What a public link (/p/:token) shows for a binary artifact (render class `file`,
 * the P6 sharing design §10): images and docx are their latest view in
 * the sandboxed frame; a pdf is its bytes, served under the frame CSP into an iframe WITHOUT
 * the sandbox attribute (Chromium's PDF viewer is blocked inside one); a pptx is a download.
 */
describe('public link files (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  const PDF = 'application/pdf';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  async function setup(contentType: 'document' | 'image', name: string) {
    const author = await f.makeUser();
    const orgId = await f.makeTeam(author.id, []);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = randomUUID();
    const registered = await f.as(author.id).post(`/work-items/${workItemId}/artifacts`, {
      id: artifactId,
      name,
      content_type: contentType,
    });
    expect(registered.status).toBe(201);
    return { author, base: `/work-items/${workItemId}/artifacts/${artifactId}` };
  }

  async function makePublic(authorId: string, base: string): Promise<string> {
    const res = await f.as(authorId).patch(`${base}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    });
    expect(res.status).toBe(200);
    return new URL(res.body.link.url as string).pathname;
  }

  it('frames a pdf from its own response, unsandboxed, under the frame CSP', async () => {
    const { author, base } = await setup('document', 'Brief');
    const bytes = Buffer.from('%PDF-1.4 public brief', 'latin1');
    const saved = await f
      .as(author.id)
      .post(`${base}/versions`, { file_base64: bytes.toString('base64'), mime_type: PDF });
    expect(saved.status).toBe(201);
    const path = await makePublic(author.id, base);

    const host = await f.anonymous().get(path);
    expect(host.status).toBe(200);
    expect(host.text).toContain(`<iframe src="${path}/file" title="Brief"></iframe>`);
    expect(host.text).not.toContain('sandbox="allow-scripts"');

    const file = await f.anonymous().get(`${path}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(PDF);
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('content-disposition')).toMatch(/^inline/);
    const csp = file.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("frame-ancestors 'self'");
    expect(file.text).toBe(bytes.toString('latin1'));

    const content = await f.anonymous().get(`${path}/content`);
    expect(content.body).toMatchObject({
      render_class: 'file',
      mime_type: PDF,
      file_path: `${path}/file`,
      frame_path: null,
      unavailable_reason: null,
    });
  });

  it('offers a pptx as a download, never inline', async () => {
    const { author, base } = await setup('document', 'Deck');
    await f.as(author.id).post(`${base}/versions`, {
      file_base64: Buffer.from('PK deck').toString('base64'),
      mime_type: PPTX,
    });
    const path = await makePublic(author.id, base);

    const host = await f.anonymous().get(path);
    expect(host.text).toContain(`<a href="${path}/file" download>`);
    expect(host.text).not.toContain('<iframe');

    const file = await f.anonymous().get(`${path}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(PPTX);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="Deck.pptx"');
  });

  it('shows an image and a docx through their view in the sandboxed frame', async () => {
    const cases = [
      { contentType: 'image' as const, mime: 'image/png', view: '<img alt="diagram">' },
      { contentType: 'document' as const, mime: DOCX, view: '<div class="docx">memo</div>' },
    ];
    for (const { contentType, mime, view } of cases) {
      const { author, base } = await setup(contentType, `A ${contentType}`);
      await f.as(author.id).post(`${base}/versions`, {
        file_base64: Buffer.from('bytes').toString('base64'),
        mime_type: mime,
        view_html: view,
      });
      const path = await makePublic(author.id, base);

      const host = await f.anonymous().get(path);
      expect(host.text).toContain(`<iframe sandbox="allow-scripts" src="${path}/frame"`);
      const frame = await f.anonymous().get(`${path}/frame`);
      expect(frame.status).toBe(200);
      expect(frame.text).toBe(view);
    }
  });

  it('says a file with no uploaded version is not published yet, and serves no file', async () => {
    const { author, base } = await setup('document', 'Empty');
    const path = await makePublic(author.id, base);

    const host = await f.anonymous().get(path);
    expect(host.status).toBe(200);
    expect(host.text).toMatch(/not published yet/i);
    expect((await f.anonymous().get(`${path}/file`)).status).toBe(404);
  });
});
