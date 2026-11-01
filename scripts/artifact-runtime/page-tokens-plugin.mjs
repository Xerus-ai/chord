import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePageTokenSheet } from './generate-page-tokens.mjs';

// Anchored on this file, not the working directory, like artifact-runtime-plugin.mjs.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_CSS = join(ROOT, 'src', 'renderer', 'index.css');
const DEFAULT_OUTPUT = join(ROOT, 'out', 'artifact-runtime', 'tokens.css');

/**
 * Writes out/artifact-runtime/tokens.css from src/renderer/index.css at the
 * start of every main-process build, so `electron-vite dev` and
 * `electron-vite build` both ship a sheet that matches the renderer's tokens.
 *
 * @returns {import('vite').Plugin}
 */
export function pageTokenSheetPlugin() {
  // Beside the main bundle, like artifact-runtime-plugin.mjs, so `--outDir` moves it too.
  let output = DEFAULT_OUTPUT;
  return {
    name: 'chord:page-token-sheet',
    configResolved(config) {
      output = join(
        dirname(resolve(config.root, config.build.outDir)),
        'artifact-runtime',
        'tokens.css'
      );
    },
    buildStart() {
      this.addWatchFile(INDEX_CSS);
      const sheet = generatePageTokenSheet(readFileSync(INDEX_CSS, 'utf8'));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, sheet);
    },
  };
}
