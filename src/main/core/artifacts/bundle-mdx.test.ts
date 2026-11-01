import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { preloadMdxBundler } from './_testing/preload-mdx-bundler';
import { bundleMdx } from './bundle-mdx';

/**
 * The real mdx-bundler over real files. Every host element an MDX page
 * renders — from markdown and from JSX written in the file, and inside the
 * components it imports — carries its source location (bead devstation-975
 * fix 5), with the file relative to the repository root.
 */
// The tests time only their own work, not bundleMdx's one-time load.
beforeAll(preloadMdxBundler, 120_000);

let root: string;
let repo: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-mdx-'));
  repo = join(root, 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(join(repo, 'ui'), { recursive: true });
  writeFileSync(
    join(repo, 'ui', 'badge.tsx'),
    'export function Badge({ n }: { n: number }) {\n  return <span className="badge">{n}</span>;\n}\n'
  );
  writeFileSync(
    join(repo, 'docs', 'page.mdx'),
    [
      'import { Badge } from "../ui/badge";',
      '',
      '# Title',
      '',
      '<div className="wrap">',
      '  <Badge n={1} />',
      '</div>',
      '',
    ].join('\n')
  );
});

let outsidePath: string;

beforeAll(() => {
  outsidePath = join(root, 'outside.json');
  writeFileSync(outsidePath, '{"secret":"do not inline"}');
  writeFileSync(
    join(repo, 'docs', 'leaky.mdx'),
    `import secret from ${JSON.stringify(outsidePath.replace(/\\/g, '/'))};\n\n# Leak\n\n<pre>{JSON.stringify(secret)}</pre>\n`
  );
});

afterAll(() => {
  removeDirSync(root);
});

describe('bundleMdx', () => {
  it('stamps markdown, JSX and imported component elements with repository-relative source locations', async () => {
    const { code } = await bundleMdx({
      filePath: join(repo, 'docs', 'page.mdx'),
      allowedRoots: [repo],
    });
    expect(code).toMatch(/fileName:\s*"docs\/page\.mdx",\s*lineNumber:\s*3,\s*columnNumber:\s*1/);
    expect(code).toMatch(/fileName:\s*"docs\/page\.mdx",\s*lineNumber:\s*5,\s*columnNumber:\s*1/);
    expect(code).toMatch(/fileName:\s*"ui\/badge\.tsx",\s*lineNumber:\s*2,\s*columnNumber:\s*10/);
    expect(code).not.toMatch(/fileName:\s*"[^"]*_mdx_bundler_entry_point/);
    expect(code).not.toContain(JSON.stringify(repo).slice(1, -1));
  });

  it('reports every sibling the build read as an input, so the cache rebuilds when one changes', async () => {
    const { inputs } = await bundleMdx({
      filePath: join(repo, 'docs', 'page.mdx'),
      allowedRoots: [repo],
    });
    expect(inputs).toContain(join(repo, 'docs', 'page.mdx'));
    expect(inputs.some((p) => p.toLowerCase().endsWith('badge.tsx'))).toBe(true);
  });

  it('refuses an import that resolves outside the allowed roots instead of bundling it', async () => {
    await expect(
      bundleMdx({ filePath: join(repo, 'docs', 'leaky.mdx'), allowedRoots: [repo] })
    ).rejects.toThrow(/outside the work item repository/);
  });

  it('stamps a stored source against the file’s own path', async () => {
    const { code } = await bundleMdx({
      filePath: join(repo, 'docs', 'page.mdx'),
      allowedRoots: [repo],
      source: '## Old\n',
    });
    expect(code).toMatch(/fileName:\s*"docs\/page\.mdx",\s*lineNumber:\s*1,\s*columnNumber:\s*1/);
  });
});
