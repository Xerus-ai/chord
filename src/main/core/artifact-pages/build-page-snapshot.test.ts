import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preloadMdxBundler } from '@main/core/artifacts/_testing/preload-mdx-bundler';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { buildPageSnapshot, MAX_PAGE_SNAPSHOT_BYTES } from './build-page-snapshot';
import type { PageSource } from './page-source-registry';

/**
 * The self-contained view uploaded with every page version (design
 * 2026-09-24 §9 "View document format"). Real files in a temp directory, the
 * real bundlers (esbuild, mdx-bundler); the runtime directory holds marker
 * files standing in for `out/artifact-runtime/`, so each inlined piece can be
 * found in the output.
 */

const MARK = {
  tokens: '/*TOKENS_MARKER*/',
  bridge: '/*BRIDGE_MARKER*/',
  components: '/*COMPONENTS_MARKER*/',
  runtime: '/*RUNTIME_MARKER*/',
  mermaid: '/*MERMAID_MARKER*/',
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const BG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
const WEBP_BYTES = Buffer.from('RIFF0000WEBPVP8 ', 'latin1');

let root: string;
let repo: string;
let siteDir: string;
let runtimeDir: string;

function webSource(fileName: string, inlineSource?: string): PageSource {
  return {
    pageId: `page-${fileName.replace(/[^a-z0-9]/gi, '')}`,
    kind: 'html',
    filePath: join(siteDir, fileName),
    workItemId: 'w-snapshot',
    allowedRoots: [repo, siteDir],
    inlineSource,
  };
}

function componentSource(kind: 'prototype' | 'mdx', fileName: string): PageSource {
  return {
    pageId: `page-${kind}-${fileName.replace(/[^a-z0-9]/gi, '')}`,
    kind,
    filePath: join(repo, fileName),
    workItemId: 'w-snapshot',
    allowedRoots: [repo],
  };
}

function base64(bytes: Buffer): string {
  return bytes.toString('base64');
}

/** Every `<script` must be closed by its own `</script>` — nothing inside may end it early. */
function expectBalancedScripts(html: string): void {
  const opens = html.match(/<script\b/gi) ?? [];
  const closes = html.match(/<\/script/gi) ?? [];
  expect(closes.length).toBe(opens.length);
}

// The tests time only their own work, not bundleMdx's one-time load.
beforeAll(preloadMdxBundler, 120_000);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-snapshot-'));
  repo = join(root, 'repo');
  siteDir = join(repo, 'site');
  runtimeDir = join(root, 'runtime');
  mkdirSync(join(siteDir, 'assets'), { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  writeFileSync(join(runtimeDir, 'tokens.css'), `${MARK.tokens}:root{--chord-bg:#000}`);
  writeFileSync(join(runtimeDir, 'chord-page.js'), `${MARK.bridge}window.__bridge=1;`);
  writeFileSync(join(runtimeDir, 'components.css'), `${MARK.components}.chord-callout{}`);
  // The standalone runtime carries a literal `</script>` and `</SCRIPT` so the
  // escaping of classic inline scripts is exercised on host code too.
  writeFileSync(
    join(runtimeDir, 'runtime-standalone.js'),
    `${MARK.runtime}window.__runtime="</script><i>";window.__upper="</SCRIPT>";`
  );
  writeFileSync(join(runtimeDir, 'mermaid-standalone.js'), `${MARK.mermaid}window.mermaid={};`);

  writeFileSync(
    join(siteDir, 'index.html'),
    [
      '<!doctype html><html><head><title>Report</title>',
      '<link rel="stylesheet" href="assets/style.css">',
      '<link rel="stylesheet" href="https://cdn.example.com/remote.css">',
      '<script src="app.js"></script>',
      '</head><body>',
      '<a href="#top">top</a>',
      '<img src="logo.png" alt="logo">',
      '<img src="https://images.example.com/hero.jpg" alt="hero">',
      '<img src="data:image/png;base64,AAAA" alt="inline">',
      '<video><source src="assets/clip.webp"></video>',
      '<script>window.inlineRan = true;</script>',
      '</body></html>',
    ].join('\n')
  );
  writeFileSync(
    join(siteDir, 'assets', 'style.css'),
    'body{background:url(bg.png)} .remote{background:url("https://cdn.example.com/x.png")}'
  );
  writeFileSync(join(siteDir, 'assets', 'bg.png'), BG_BYTES);
  writeFileSync(join(siteDir, 'assets', 'clip.webp'), WEBP_BYTES);
  writeFileSync(join(siteDir, 'app.js'), 'document.title = "ran"; var closer = "</script><b>";');
  writeFileSync(join(siteDir, 'logo.png'), PNG_BYTES);

  writeFileSync(
    join(siteDir, 'missing-asset.html'),
    '<html><head></head><body><img src="missing.png"></body></html>'
  );
  writeFileSync(join(repo, 'outside.png'), PNG_BYTES);
  writeFileSync(
    join(siteDir, 'escaping.html'),
    '<html><head></head><body><img src="../outside.png"></body></html>'
  );
  // 9 MiB of image: its data: URI alone is past the cap.
  writeFileSync(join(siteDir, 'huge.png'), Buffer.alloc(9 * 1024 * 1024, 7));
  writeFileSync(
    join(siteDir, 'huge.html'),
    '<html><head></head><body><img src="huge.png"></body></html>'
  );

  writeFileSync(
    join(repo, 'counter.tsx'),
    `import { useState } from 'react';
import { Callout } from 'chord-components';
export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <div>
      <Callout type="info">{"</SCRIPT> inside a string"}</Callout>
      <button onClick={() => setN(n + 1)}>{\`Clicked \${n} times\`}</button>
    </div>
  );
}
`
  );
  writeFileSync(
    join(repo, 'diagram.tsx'),
    `import { MermaidDiagram } from 'chord-components';
export default function Diagram() {
  return <MermaidDiagram chart="graph TD; A-->B" />;
}
`
  );
  writeFileSync(join(repo, 'broken.tsx'), 'export default function Broken() { return <div>; }');
  writeFileSync(join(repo, 'notes.mdx'), '# Hello MDX\n\nSome *prose* here.\n');
  writeFileSync(
    join(repo, 'flow.mdx'),
    `import { MermaidDiagram } from 'chord-components'

# Flow

<MermaidDiagram chart="graph TD; A-->B" />
`
  );
});

afterAll(() => {
  removeDirSync(root);
});

describe('buildPageSnapshot — web pages', () => {
  it('inlines the token sheet and the frame bridge as the first children of <head>', async () => {
    const { html } = await buildPageSnapshot({ source: webSource('index.html'), runtimeDir });
    expect(html).toContain(MARK.tokens);
    expect(html).toContain(MARK.bridge);
    expect(html.indexOf(MARK.tokens)).toBeLessThan(html.indexOf('<title>'));
    expect(html.indexOf(MARK.bridge)).toBeLessThan(html.indexOf('<title>'));
    // Nothing points back at the author's device or the host protocol.
    expect(html).not.toContain('chord-artifact://');
    expect(html).not.toContain('/__chord/');
  });

  it('inlines a sibling stylesheet, the images its url()s name, a script, an <img> and a <source>', async () => {
    const { html } = await buildPageSnapshot({ source: webSource('index.html'), runtimeDir });
    expect(html).not.toMatch(/href="assets\/style\.css"/);
    expect(html).not.toMatch(/src="app\.js"/);
    expect(html).not.toMatch(/src="logo\.png"/);
    expect(html).not.toMatch(/src="assets\/clip\.webp"/);

    // The stylesheet's own relative url() resolves against the sheet's directory.
    expect(html).toContain(`url("data:image/png;base64,${base64(BG_BYTES)}")`);
    expect(html).toContain(`src="data:image/png;base64,${base64(PNG_BYTES)}"`);
    expect(html).toContain(`src="data:image/webp;base64,${base64(WEBP_BYTES)}"`);
    expect(html).toContain('document.title = "ran"');
    expect(html).toContain('window.inlineRan = true;');
  });

  it('escapes </script inside every inlined script', async () => {
    const { html } = await buildPageSnapshot({ source: webSource('index.html'), runtimeDir });
    expect(html).not.toContain('"</script><b>"');
    expect(html).toContain('"<\\/script><b>"');
    expectBalancedScripts(html);
  });

  it('leaves remote references alone and reports each as a warning', async () => {
    const { html, warnings } = await buildPageSnapshot({
      source: webSource('index.html'),
      runtimeDir,
    });
    expect(html).toContain('href="https://cdn.example.com/remote.css"');
    expect(html).toContain('src="https://images.example.com/hero.jpg"');
    expect(html).toContain('https://cdn.example.com/x.png');
    for (const url of [
      'https://cdn.example.com/remote.css',
      'https://images.example.com/hero.jpg',
      'https://cdn.example.com/x.png',
    ]) {
      expect(warnings.some((warning) => warning.includes(url))).toBe(true);
    }
    // Fragments and data: URIs are neither assets nor remote.
    expect(html).toContain('href="#top"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(warnings).toHaveLength(3);
  });

  it('builds from a stored version’s source instead of the file on disk', async () => {
    const { html } = await buildPageSnapshot({
      source: webSource(
        'index.html',
        '<html><head></head><body><p>version one</p><img src="logo.png"></body></html>'
      ),
      runtimeDir,
    });
    expect(html).toContain('version one');
    expect(html).not.toContain('<title>Report</title>');
    expect(html).toContain(`src="data:image/png;base64,${base64(PNG_BYTES)}"`);
  });

  it('fails on a missing local asset, naming it', async () => {
    await expect(
      buildPageSnapshot({ source: webSource('missing-asset.html'), runtimeDir })
    ).rejects.toThrow(/missing\.png/);
  });

  it('refuses an asset outside the page directory instead of inlining it', async () => {
    await expect(
      buildPageSnapshot({ source: webSource('escaping.html'), runtimeDir })
    ).rejects.toThrow(/\.\.\/outside\.png/);
  });

  it('refuses a view larger than 8 MiB', async () => {
    expect(MAX_PAGE_SNAPSHOT_BYTES).toBe(8 * 1024 * 1024);
    await expect(buildPageSnapshot({ source: webSource('huge.html'), runtimeDir })).rejects.toThrow(
      /8 MiB/
    );
  });
});

describe('buildPageSnapshot — prototypes', () => {
  it('inlines components.css, the standalone runtime and the bundle as classic scripts', async () => {
    const { html, warnings } = await buildPageSnapshot({
      source: componentSource('prototype', 'counter.tsx'),
      runtimeDir,
    });
    expect(warnings).toEqual([]);
    for (const marker of [MARK.tokens, MARK.bridge, MARK.components, MARK.runtime]) {
      expect(html).toContain(marker);
    }
    expect(html).toContain('id="chord-root"');
    expect(html).toContain('Clicked');
    // The runtime's globals exist before the bundle runs.
    expect(html.indexOf(MARK.runtime)).toBeLessThan(html.indexOf('Clicked'));
    // Self-contained: no external script or stylesheet, and no module scripts.
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*\shref=/i);
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('chord-artifact://');
  });

  it('leaves mermaid out when the bundle does not use MermaidDiagram', async () => {
    const { html } = await buildPageSnapshot({
      source: componentSource('prototype', 'counter.tsx'),
      runtimeDir,
    });
    expect(html).not.toContain(MARK.mermaid);
  });

  it('includes mermaid, before the bundle, when the bundle uses MermaidDiagram', async () => {
    const { html } = await buildPageSnapshot({
      source: componentSource('prototype', 'diagram.tsx'),
      runtimeDir,
    });
    expect(html).toContain(MARK.mermaid);
    expect(html.indexOf(MARK.mermaid)).toBeLessThan(html.indexOf('graph TD'));
  });

  it('escapes </script in the runtime and in the bundle, in any case', async () => {
    const { html } = await buildPageSnapshot({
      source: componentSource('prototype', 'counter.tsx'),
      runtimeDir,
    });
    expect(html).not.toContain('"</script><i>"');
    expect(html).not.toContain('"</SCRIPT>"');
    expect(html).not.toContain('</SCRIPT> inside a string');
    expectBalancedScripts(html);
  });

  it('fails with the compiler message when the prototype does not compile', async () => {
    await expect(
      buildPageSnapshot({ source: componentSource('prototype', 'broken.tsx'), runtimeDir })
    ).rejects.toThrow(/broken\.tsx/);
  });
});

describe('buildPageSnapshot — rich documents (mdx)', () => {
  it('inlines the runtime and the compiled document, without mermaid when unused', async () => {
    const { html } = await buildPageSnapshot({
      source: componentSource('mdx', 'notes.mdx'),
      runtimeDir,
    });
    expect(html).toContain(MARK.runtime);
    expect(html).toContain(MARK.components);
    expect(html).toContain('Hello MDX');
    expect(html).toContain('id="chord-root"');
    expect(html).not.toContain(MARK.mermaid);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expectBalancedScripts(html);
  });

  it('includes mermaid when the document uses MermaidDiagram', async () => {
    const { html } = await buildPageSnapshot({
      source: componentSource('mdx', 'flow.mdx'),
      runtimeDir,
    });
    expect(html).toContain(MARK.mermaid);
  });
});
