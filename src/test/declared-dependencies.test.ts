import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * electron-builder ships every runtime dependency with the app, so one nothing uses costs
 * install time and package size for nothing. 37 had piled up (devstation-yxts); this keeps the
 * list honest. A dependency counts as used only when app code loads it: a module specifier in a
 * tracked source file outside the tests (`from`, `import()`, `require()`, a bare `import`, CSS
 * `@import` / `@plugin`), or a word in the root package.json scripts. A type package counts when
 * its runtime package is loaded. Prose, docs and other manifests never count.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  scripts?: Record<string, string>;
};

function readSources(): string {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter((f) => /\.(tsx?|mts|cts|mjs|cjs|jsx?|css)$/.test(f))
    .filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f) && !f.split('/').includes('node_modules'));
  return files.map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** `name` or a subpath of it, as a module specifier. */
function isLoaded(sources: string, name: string): boolean {
  const spec = `['"\`]${escapeRegExp(name)}(?:/[^'"\`]*)?['"\`]`;
  const loaders = [
    `\\bfrom\\s*${spec}`,
    `\\bimport\\s*\\(\\s*${spec}`,
    `\\brequire\\s*\\(\\s*${spec}`,
    `\\bimport\\s+${spec}`,
    `@(?:import|plugin)\\s+${spec}`,
  ];
  return new RegExp(loaders.join('|')).test(sources);
}

/** `name` as a word of a root package.json script (a CLI it provides). */
function isRunByScript(name: string): boolean {
  const scripts = Object.values(pkg.scripts ?? {}).join('\n');
  return new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s|$)`, 'm').test(scripts);
}

describe('declared runtime dependencies', () => {
  it('loads every one somewhere in the app', () => {
    const sources = readSources();
    const unused = Object.keys(pkg.dependencies).filter((dep) => {
      const runtime = dep.startsWith('@types/') ? dep.slice('@types/'.length) : dep;
      return !isLoaded(sources, runtime) && !isRunByScript(runtime);
    });
    expect(unused).toEqual([]);
  });
});
