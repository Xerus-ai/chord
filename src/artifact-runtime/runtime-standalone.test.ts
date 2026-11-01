import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { buildArtifactRuntime } from '../../scripts/artifact-runtime/artifact-runtime-plugin.mjs';

/**
 * The page view uploaded with each version inlines the runtime as classic
 * scripts (design 2026-09-24 §9), so the build also emits a standalone IIFE
 * runtime with no code splitting, and mermaid as its own IIFE that the view
 * includes only when a diagram is used. Built for real with esbuild into a
 * temp directory.
 */

let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'chord-runtime-'));
  await buildArtifactRuntime(outDir);
}, 180_000);

afterAll(() => {
  removeDirSync(outDir);
});

function read(name: string): string {
  return readFileSync(join(outDir, name), 'utf8');
}

describe('buildArtifactRuntime — standalone outputs', () => {
  it('still emits the served runtime, bridge and component sheet', () => {
    for (const name of ['runtime.js', 'chord-page.js', 'components.css']) {
      expect(statSync(join(outDir, name)).size).toBeGreaterThan(0);
    }
  });

  it('emits runtime-standalone.js: one classic script, no modules, no chunks, no mermaid inside', () => {
    const code = read('runtime-standalone.js');
    expect(code).not.toMatch(/\bimport\(/);
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).not.toContain('chunks/');
    // mermaid (~3 MB) is delivered separately; the runtime alone is well under it.
    expect(statSync(join(outDir, 'runtime-standalone.js')).size).toBeLessThan(1_500_000);
  });

  it('sets the globals prototypes and MDX bundles are compiled against when run as a script', () => {
    const context: Record<string, unknown> = {
      console,
      setTimeout,
      clearTimeout,
      queueMicrotask,
    };
    context.window = context;
    context.self = context;
    runInNewContext(read('runtime-standalone.js'), context);
    for (const name of ['React', 'ReactDOM', 'ReactDOMClient', '_jsx_runtime', 'Recharts']) {
      expect(context[name], name).toBeDefined();
    }
    const components = context.ChordComponents as Record<string, unknown>;
    expect(typeof components.MermaidDiagram).toBe('function');
    expect(typeof components.Callout).toBe('function');
  });

  it('emits mermaid-standalone.js: a classic script that sets window.mermaid', () => {
    const code = read('mermaid-standalone.js');
    expect(code).not.toMatch(/\bimport\(/);
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(code).toMatch(/window\.mermaid\s*=/);
    expect(statSync(join(outDir, 'mermaid-standalone.js')).size).toBeGreaterThan(1_000_000);
  });
});

describe('mermaid window shim', () => {
  it('gives import("mermaid") a default export that reads window.mermaid when used', async () => {
    const globals = globalThis as unknown as { window?: { mermaid?: unknown } };
    const previous = globals.window;
    globals.window = {};
    try {
      const shim = await import('./mermaid-window-shim');
      // Loaded after the shim module evaluated, as mermaid-standalone.js is.
      const initialize = () => 'initialized';
      const render = async () => ({ svg: '<svg></svg>' });
      globals.window.mermaid = { initialize, render };
      expect(shim.default.initialize).toBe(initialize);
      expect(shim.default.render).toBe(render);
    } finally {
      globals.window = previous;
    }
  });

  it('fails loudly when a diagram renders without mermaid loaded', async () => {
    const globals = globalThis as unknown as { window?: { mermaid?: unknown } };
    const previous = globals.window;
    globals.window = {};
    try {
      const shim = await import('./mermaid-window-shim');
      expect(() => shim.default.initialize).toThrow(/mermaid/);
    } finally {
      globals.window = previous;
    }
  });
});
