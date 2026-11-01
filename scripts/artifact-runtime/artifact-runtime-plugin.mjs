import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Builds the vendored artifact-page runtime into `out/artifact-runtime/`:
 *
 *   runtime.js      React + ReactDOM + recharts + chord-components, exposed as
 *                   the globals MDX bundles and prototypes are compiled against
 *                   (src/artifact-runtime/runtime-entry.ts). mermaid is a
 *                   code-split chunk next to it, loaded on first diagram.
 *   chord-page.js   the frame side of the host <-> page bridge
 *   components.css  styles for chord-components, tokens only
 *   runtime-standalone.js   the same runtime as one classic script with no
 *                   chunks; `import('mermaid')` reads `window.mermaid`
 *                   (src/artifact-runtime/mermaid-window-shim.ts)
 *   mermaid-standalone.js   mermaid as one classic script setting
 *                   `window.mermaid`
 *   docx-viewer-standalone.js   docx-preview + jszip as one classic script
 *                   that renders the docx a file view carries
 *                   (src/artifact-runtime/docx-viewer-entry.ts)
 *
 * The first three are served to sandboxed pages over `chord-artifact://` by
 * main/core/artifact-pages. The standalone files are inlined into the
 * self-contained view uploaded with each page version
 * (main/core/artifact-pages/build-page-snapshot.ts) or docx version
 * (main/core/artifact-files/build-file-view.ts), which can fetch nothing.
 * Registered on the main-process Vite config so both `electron-vite dev` and
 * `electron-vite build` produce them.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src', 'artifact-runtime');
export const ARTIFACT_RUNTIME_OUT_DIR = join(ROOT, 'out', 'artifact-runtime');

const sharedOptions = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  // d3-shape carries its own older d3-path; pin to the root copy exactly as
  // electron.vite.config.ts does for the renderer, or esbuild sees two
  // incompatible d3-path versions and fails on the `Path` export.
  alias: {
    '@shared': join(ROOT, 'src', 'shared'),
    'd3-path': join(ROOT, 'node_modules', 'd3-path'),
  },
};

export async function buildArtifactRuntime(outDir = ARTIFACT_RUNTIME_OUT_DIR) {
  mkdirSync(outDir, { recursive: true });

  // ESM with code splitting so mermaid (~3 MB) is its own chunk, fetched by
  // dynamic import() on the first diagram. The page loads runtime.js and the
  // compiled bundle as <script type="module"> in that order; module scripts
  // execute in document order, so the globals exist before the bundle runs.
  await esbuild.build({
    ...sharedOptions,
    entryPoints: { runtime: join(SRC, 'runtime-entry.ts') },
    outdir: outDir,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    jsx: 'automatic',
  });

  await esbuild.build({
    ...sharedOptions,
    entryPoints: { 'chord-page': join(SRC, 'chord-page.ts') },
    outdir: outDir,
    format: 'iife',
  });

  await esbuild.build({
    ...sharedOptions,
    entryPoints: { components: join(SRC, 'chord-components.css') },
    outdir: outDir,
  });

  // A page view is one document with every script inline, so this runtime
  // has no chunks to fetch: a classic IIFE, with mermaid resolved to the
  // shim that reads the separately inlined mermaid-standalone.js.
  await esbuild.build({
    ...sharedOptions,
    alias: { ...sharedOptions.alias, mermaid: join(SRC, 'mermaid-window-shim.ts') },
    entryPoints: { 'runtime-standalone': join(SRC, 'runtime-entry.ts') },
    outdir: outDir,
    format: 'iife',
    jsx: 'automatic',
  });

  await esbuild.build({
    ...sharedOptions,
    entryPoints: { 'mermaid-standalone': join(SRC, 'mermaid-standalone-entry.ts') },
    outdir: outDir,
    format: 'iife',
  });

  await esbuild.build({
    ...sharedOptions,
    entryPoints: { 'docx-viewer-standalone': join(SRC, 'docx-viewer-entry.ts') },
    outdir: outDir,
    format: 'iife',
  });

  return {
    runtimeBytes: statSync(join(outDir, 'runtime.js')).size,
    standaloneRuntimeBytes: statSync(join(outDir, 'runtime-standalone.js')).size,
    mermaidBytes: statSync(join(outDir, 'mermaid-standalone.js')).size,
    docxViewerBytes: statSync(join(outDir, 'docx-viewer-standalone.js')).size,
  };
}

/** @returns {import('vite').Plugin} */
export function artifactRuntimePlugin() {
  // Beside the main bundle, so `electron-vite build --outDir <dir>` puts the
  // runtime in `<dir>/artifact-runtime` (scripts/e2e/build-e2e-app.mjs).
  let outDir = ARTIFACT_RUNTIME_OUT_DIR;
  return {
    name: 'chord-artifact-runtime',
    configResolved(config) {
      outDir = join(dirname(resolve(config.root, config.build.outDir)), 'artifact-runtime');
    },
    async buildStart() {
      const { runtimeBytes, standaloneRuntimeBytes, mermaidBytes, docxViewerBytes } =
        await buildArtifactRuntime(outDir);
      const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
      this.info(
        `artifact runtime: ${kb(runtimeBytes)}; standalone ${kb(standaloneRuntimeBytes)} + mermaid ${kb(mermaidBytes)}; docx viewer ${kb(docxViewerBytes)}`
      );
    },
  };
}
