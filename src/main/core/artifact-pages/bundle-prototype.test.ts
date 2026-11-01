import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { bundlePrototype } from './bundle-prototype';

let root: string;
let repo: string;
let outsidePath: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-proto-'));
  repo = join(root, 'repo');
  mkdirSync(join(repo, 'ui'), { recursive: true });
  writeFileSync(
    join(repo, 'counter.tsx'),
    `import { useState } from 'react';
import { Callout } from 'chord-components';
import { label } from './ui/label';
export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <div>
      <Callout type="info">count</Callout>
      <button id="inc" onClick={() => setN(n + 1)}>{label(n)}</button>
    </div>
  );
}
`
  );
  writeFileSync(
    join(repo, 'ui', 'label.ts'),
    'export const label = (n: number) => `Clicked ${n} times`;'
  );
  writeFileSync(
    join(repo, 'ui', 'badge.tsx'),
    `export function Badge({ n }: { n: number }) {
  return <span className="badge">{n}</span>;
}
`
  );
  writeFileSync(
    join(repo, 'stamped.tsx'),
    `import { Badge } from './ui/badge';
export default function Stamped() {
  return (
    <main>
      <Badge n={1} />
    </main>
  );
}
`
  );
  writeFileSync(join(repo, 'broken.tsx'), 'export default function Broken() { return <div>; }');
  writeFileSync(join(repo, 'empty.tsx'), '   \n');
  outsidePath = join(root, 'outside.json');
  writeFileSync(outsidePath, '{"secret":"do not inline"}');
  writeFileSync(
    join(repo, 'leaky.tsx'),
    `import secret from ${JSON.stringify(outsidePath.replace(/\\/g, '/'))};
export default function Leaky() { return <pre>{JSON.stringify(secret)}</pre>; }`
  );
});

afterAll(() => {
  removeDirSync(root);
});

const roots = () => [repo];

describe('bundlePrototype', () => {
  it('compiles a .tsx entry against the vendored runtime globals, not an inlined React', async () => {
    const { code, inputs } = await bundlePrototype({
      entryPath: join(repo, 'counter.tsx'),
      allowedRoots: roots(),
    });
    expect(code).toContain('window.React');
    expect(code).toContain('window.ReactDOMClient');
    expect(code).toContain('window._jsx_runtime');
    expect(code).toContain('window.ChordComponents');
    expect(code).toContain('chord-root');
    expect(code).toContain('Clicked');
    // React itself must not be inlined — a second copy breaks hooks.
    expect(code).not.toContain('react.production');
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/\bnew\s+Function\s*\(/);
    // Every file the build read is reported, so the cache can watch them all.
    expect(inputs).toContain(join(repo, 'counter.tsx'));
    expect(inputs.some((p) => p.toLowerCase().endsWith(join('ui', 'label.ts').toLowerCase()))).toBe(
      true
    );
  });

  it('compiles a stored source in place of the file, resolving siblings from its directory', async () => {
    const { code, inputs } = await bundlePrototype({
      entryPath: join(repo, 'counter.tsx'),
      allowedRoots: roots(),
      source: `import { label } from './ui/label';
export default function Old() { return <b>{label(9)}</b>; }`,
    });
    expect(code).toContain('Clicked');
    expect(code).not.toContain('chord-callout');
    expect(inputs).not.toContain(join(repo, 'counter.tsx'));
  });

  it('stamps every host element with its source location, relative to the repository root', async () => {
    const { code } = await bundlePrototype({
      entryPath: join(repo, 'stamped.tsx'),
      allowedRoots: roots(),
    });
    // The entry's <main> (line 4, column 5) and the component's own <span>
    // (badge.tsx line 2, column 10) — never the <Badge /> call site's location
    // on a DOM element, and never an absolute path or the entry namespace.
    expect(code).toMatch(/fileName:\s*"stamped\.tsx",\s*lineNumber:\s*4,\s*columnNumber:\s*5/);
    expect(code).toMatch(/fileName:\s*"ui\/badge\.tsx",\s*lineNumber:\s*2,\s*columnNumber:\s*10/);
    expect(code).not.toContain('entry:');
    expect(code).not.toContain(JSON.stringify(repo).slice(1, -1));
    expect(code).toContain('jsxDEV');
  });

  it('stamps a stored source with the entry file’s path too', async () => {
    const { code } = await bundlePrototype({
      entryPath: join(repo, 'stamped.tsx'),
      allowedRoots: roots(),
      source: 'export default function Old() { return <b>old</b>; }',
    });
    expect(code).toMatch(/fileName:\s*"stamped\.tsx",\s*lineNumber:\s*1,\s*columnNumber:\s*40/);
  });

  it('refuses an import that resolves outside the allowed roots', async () => {
    await expect(
      bundlePrototype({ entryPath: join(repo, 'leaky.tsx'), allowedRoots: roots() })
    ).rejects.toThrow(/outside the work item repository/);
  });

  it('reports a syntax error with esbuild’s message instead of a blank bundle', async () => {
    await expect(
      bundlePrototype({ entryPath: join(repo, 'broken.tsx'), allowedRoots: roots() })
    ).rejects.toThrow(/broken\.tsx/);
  });

  it('refuses an empty entry', async () => {
    await expect(
      bundlePrototype({ entryPath: join(repo, 'empty.tsx'), allowedRoots: roots() })
    ).rejects.toThrow(/empty/);
  });
});
