import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { buildFileView, FileViewTooLargeError } from './build-file-view';

/**
 * The view uploaded with an image or docx version (design 2026-09-24 §10
 * decision 4): one self-contained HTML document, shown in the page sandbox like
 * any page view. The runtime directory holds marker files standing in for
 * `out/artifact-runtime/`, so each inlined piece can be found in the output.
 */

const MARK = {
  tokens: '/*TOKENS_MARKER*/',
  bridge: '/*BRIDGE_MARKER*/',
  // A viewer bundle that contains the sequence that would end its script tag.
  docx: '/*DOCX_VIEWER_MARKER*/var closer="</script>";',
};

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let root: string;
let runtimeDir: string;

function expectBalancedScripts(html: string): void {
  const opens = html.match(/<script\b/gi) ?? [];
  const closes = html.match(/<\/script/gi) ?? [];
  expect(closes.length).toBe(opens.length);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-file-view-'));
  runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), `${MARK.tokens}:root{}`);
  writeFileSync(join(runtimeDir, 'chord-page.js'), `${MARK.bridge}window.__bridge=1;`);
  writeFileSync(join(runtimeDir, 'docx-viewer-standalone.js'), MARK.docx);
});

afterAll(() => {
  removeDirSync(root);
});

describe('buildFileView', () => {
  it('shows an image as a data: URL on the page tokens, with its name as alt text', async () => {
    const html = await buildFileView({
      fileName: 'chart "Q3".png',
      mimeType: 'image/png',
      bytes: PNG_BYTES,
      runtimeDir,
    });
    expect(html).not.toBeNull();
    expect(html).toContain(`src="data:image/png;base64,${PNG_BYTES.toString('base64')}"`);
    expect(html).toContain('alt="chart &quot;Q3&quot;.png"');
    expect(html).toContain(MARK.tokens);
    expect(html).toContain(MARK.bridge);
    expectBalancedScripts(html!);
  });

  it('keeps an SVG an image: data: URL in an <img>, never inline markup that could run', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    );
    const html = await buildFileView({
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
      bytes: svg,
      runtimeDir,
    });
    expect(html).toContain(`src="data:image/svg+xml;base64,${svg.toString('base64')}"`);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('alert(1)');
  });

  it('renders a docx through the inlined viewer, with the file bytes as inert base64', async () => {
    const bytes = Buffer.from('PK\u0003\u0004 word/document.xml', 'latin1');
    const html = await buildFileView({ fileName: 'memo.docx', mimeType: DOCX, bytes, runtimeDir });
    expect(html).toContain('/*DOCX_VIEWER_MARKER*/');
    expect(html).toContain(
      `<script type="application/octet-stream" id="chord-file">${bytes.toString('base64')}</script>`
    );
    expect(html).toContain(MARK.tokens);
    // The viewer's own "</script>" is escaped, so every tag closes where it should.
    expectBalancedScripts(html!);
  });

  it('builds no view for a pdf or a pptx: they are shown from their own bytes', async () => {
    for (const mimeType of ['application/pdf', PPTX] as const) {
      expect(
        await buildFileView({ fileName: 'x', mimeType, bytes: Buffer.from('x'), runtimeDir })
      ).toBeNull();
    }
  });

  it('fails a docx whose view would pass the 8 MiB view cap, naming the size', async () => {
    const bytes = Buffer.alloc(6_500_000, 7);
    await expect(
      buildFileView({ fileName: 'huge.docx', mimeType: DOCX, bytes, runtimeDir })
    ).rejects.toThrow(FileViewTooLargeError);
    await expect(
      buildFileView({ fileName: 'huge.docx', mimeType: DOCX, bytes, runtimeDir })
    ).rejects.toThrow(/8 MiB/);
  });

  it('fails loudly when the runtime has no docx viewer', async () => {
    const bare = join(root, 'bare-runtime');
    mkdirSync(bare, { recursive: true });
    writeFileSync(join(bare, 'tokens.css'), ':root{}');
    writeFileSync(join(bare, 'chord-page.js'), '');
    await expect(
      buildFileView({
        fileName: 'memo.docx',
        mimeType: DOCX,
        bytes: Buffer.from('PK'),
        runtimeDir: bare,
      })
    ).rejects.toThrow(/docx-viewer-standalone\.js is missing/);
  });
});
