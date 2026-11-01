import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Builds the `chord` MCP stdio shim (src/chord-mcp-shim/chord-mcp-stdio.ts)
 * into `out/chord-mcp/chord-mcp-stdio.cjs`: one self-contained CommonJS file
 * with no imports outside Node's own modules, because it runs under Chord's
 * executable in Node mode, where the app's bundle and node_modules are not
 * on its path. Registered on the main-process Vite config so both
 * `electron-vite dev` and `electron-vite build` produce it.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHORD_MCP_OUT_DIR = join(ROOT, 'out', 'chord-mcp');

export async function buildChordMcpShim(outDir = CHORD_MCP_OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(ROOT, 'src', 'chord-mcp-shim', 'chord-mcp-stdio.ts')],
    outfile: join(outDir, 'chord-mcp-stdio.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'error',
  });
}

/** @returns {import('vite').Plugin} */
export function chordMcpShimPlugin() {
  // Beside the main bundle, so `--outDir <dir>` builds `<dir>/chord-mcp`.
  let outDir = CHORD_MCP_OUT_DIR;
  return {
    name: 'chord-mcp-shim',
    configResolved(config) {
      outDir = join(dirname(resolve(config.root, config.build.outDir)), 'chord-mcp');
    },
    async buildStart() {
      await buildChordMcpShim(outDir);
    },
  };
}
