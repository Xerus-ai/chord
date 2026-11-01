import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * Binary artifacts under the P6 viewing model (the P6 sharing design
 * §10): `.pdf/.docx/.pptx` and images are render class `file`. A file version carries the
 * file's bytes (base64) and MIME type; images and docx also carry the view the author's app
 * built. Bytes are capped at 8 MiB and kept, like views, for the newest 10 versions.
 */
describe('file artifact versions (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  const MiB = 1024 * 1024;
  const PDF = 'application/pdf';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function base64(text: string): string {
    return Buffer.from(text, 'latin1').toString('base64');
  }

  async function setup(contentType: 'document' | 'image') {
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
      name: contentType === 'image' ? 'diagram.png' : 'brief.pdf',
      content_type: contentType,
    });
    expect(registered.status).toBe(201);
    const base = `/work-items/${workItemId}/artifacts/${artifactId}`;
    return { author, workItemId, artifactId, base, versionsPath: `${base}/versions` };
  }

  async function fileRows(artifactId: string) {
    const { eq } = await import('drizzle-orm');
    return f.db
      .select({
        version_id: f.s.artifactVersionFiles.version_id,
        version_number: f.s.artifactVersions.version_number,
        mime_type: f.s.artifactVersionFiles.mime_type,
        byte_size: f.s.artifactVersionFiles.byte_size,
        content_base64: f.s.artifactVersionFiles.content_base64,
      })
      .from(f.s.artifactVersionFiles)
      .innerJoin(
        f.s.artifactVersions,
        eq(f.s.artifactVersions.id, f.s.artifactVersionFiles.version_id)
      )
      .where(eq(f.s.artifactVersions.artifact_id, artifactId))
      .orderBy(f.s.artifactVersions.version_number);
  }

  async function versionCount(artifactId: string): Promise<number> {
    const { eq } = await import('drizzle-orm');
    const rows = await f.db
      .select({ id: f.s.artifactVersions.id })
      .from(f.s.artifactVersions)
      .where(eq(f.s.artifactVersions.artifact_id, artifactId));
    return rows.length;
  }

  it('registers documents and images as render class file', async () => {
    for (const contentType of ['document', 'image'] as const) {
      const { artifactId } = await setup(contentType);
      const { eq } = await import('drizzle-orm');
      const [row] = await f.db
        .select({ render_class: f.s.artifacts.render_class })
        .from(f.s.artifacts)
        .where(eq(f.s.artifacts.id, artifactId));
      expect(row!.render_class).toBe('file');
    }
  });

  it('stores a pdf version as its bytes and MIME type, without a view', async () => {
    const { author, artifactId, versionsPath } = await setup('document');
    const bytes = base64('%PDF-1.4 brief');

    const res = await f.as(author.id).post(versionsPath, {
      file_base64: bytes,
      mime_type: PDF,
      trigger: 'agent_milestone',
      client_version_id: 'pdf-1',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      version_number: 1,
      trigger: 'agent_milestone',
      byte_size: 14,
      has_view: false,
    });
    expect(res.body).not.toHaveProperty('file_base64');
    expect(await fileRows(artifactId)).toEqual([
      {
        version_id: res.body.id,
        version_number: 1,
        mime_type: PDF,
        byte_size: 14,
        content_base64: bytes,
      },
    ]);

    const retry = await f.as(author.id).post(versionsPath, {
      file_base64: bytes,
      mime_type: PDF,
      trigger: 'agent_milestone',
      client_version_id: 'pdf-1',
    });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(res.body.id);
    expect(await versionCount(artifactId)).toBe(1);
  });

  it('requires a view for an image and a docx, and refuses one for a pdf and a pptx', async () => {
    const image = await setup('image');
    const noView = await f
      .as(image.author.id)
      .post(image.versionsPath, { file_base64: base64('png'), mime_type: 'image/png' });
    expect(noView.status).toBe(400);
    expect(JSON.stringify(noView.body)).toMatch(/view_html/);
    const withView = await f.as(image.author.id).post(image.versionsPath, {
      file_base64: base64('png'),
      mime_type: 'image/png',
      view_html: '<img src="data:image/png;base64,cG5n">',
    });
    expect(withView.status).toBe(201);
    expect(withView.body.has_view).toBe(true);

    const doc = await setup('document');
    const docxNoView = await f
      .as(doc.author.id)
      .post(doc.versionsPath, { file_base64: base64('PK docx'), mime_type: DOCX });
    expect(docxNoView.status).toBe(400);
    for (const mime of [PDF, PPTX]) {
      const refused = await f.as(doc.author.id).post(doc.versionsPath, {
        file_base64: base64('bytes'),
        mime_type: mime,
        view_html: '<p>no view for this format</p>',
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toMatch(/view_html/);
    }
    expect(await versionCount(doc.artifactId)).toBe(0);
  });

  it('refuses page source, a missing file, an unknown MIME type and one that contradicts the content type', async () => {
    const { author, artifactId, versionsPath } = await setup('document');
    const cases = [
      { content: 'source', file_base64: base64('x'), mime_type: PDF },
      { mime_type: PDF },
      { file_base64: base64('<b>x</b>'), mime_type: 'text/html' },
      { file_base64: base64('png'), mime_type: 'image/png', view_html: '<img>' },
    ];
    for (const body of cases) {
      const res = await f.as(author.id).post(versionsPath, body);
      expect(res.status).toBe(400);
    }
    expect(await versionCount(artifactId)).toBe(0);
  });

  it('accepts exactly 8 MiB of bytes and refuses one byte more with 413', async () => {
    const { author, artifactId, versionsPath } = await setup('document');
    const atCap = await f.as(author.id).post(versionsPath, {
      file_base64: Buffer.alloc(8 * MiB, 1).toString('base64'),
      mime_type: PDF,
    });
    expect(atCap.status).toBe(201);

    const overCap = await f.as(author.id).post(versionsPath, {
      file_base64: Buffer.alloc(8 * MiB + 1, 1).toString('base64'),
      mime_type: PDF,
    });
    expect(overCap.status).toBe(413);
    expect(overCap.body).toEqual({ error: 'file_too_large', max_bytes: 8 * MiB });
    expect(await versionCount(artifactId)).toBe(1);
  }, 60_000);

  it('keeps file bytes for the newest 10 versions only, and every version itself', async () => {
    const { author, artifactId, versionsPath } = await setup('document');
    for (let n = 1; n <= 12; n++) {
      const res = await f
        .as(author.id)
        .post(versionsPath, { file_base64: base64(`pdf ${n}`), mime_type: PDF });
      expect(res.status).toBe(201);
    }
    expect(await versionCount(artifactId)).toBe(12);
    const files = await fileRows(artifactId);
    expect(files.map((row) => row.version_number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('serves the latest file, or a named version, to anyone with view access', async () => {
    const { author, base, versionsPath } = await setup('document');
    const first = await f
      .as(author.id)
      .post(versionsPath, { file_base64: base64('pdf one'), mime_type: PDF });
    await f.as(author.id).post(versionsPath, {
      file_base64: base64('docx two'),
      mime_type: DOCX,
      view_html: '<p>two</p>',
    });

    const latest = await f.as(author.id).get(`${base}/file`);
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({
      version_number: 2,
      mime_type: DOCX,
      byte_size: 8,
      file_base64: base64('docx two'),
    });

    const named = await f.as(author.id).get(`${base}/file?version_id=${first.body.id}`);
    expect(named.body).toMatchObject({ version_number: 1, mime_type: PDF });

    const stranger = await f.makeUser();
    expect((await f.as(stranger.id).get(`${base}/file`)).status).toBe(404);
  });

  it('answers 404 no_file for a file artifact with no uploaded version', async () => {
    const { author, base } = await setup('image');
    const res = await f.as(author.id).get(`${base}/file`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no_file' });
  });
});
