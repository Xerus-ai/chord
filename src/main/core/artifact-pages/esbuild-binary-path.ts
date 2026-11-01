import { createRequire } from 'node:module';
import { unpackedAsarPath } from '@main/utils/unpacked-asar-path';

/**
 * esbuild compiles MDX components and `.tsx` prototypes at runtime by spawning
 * its platform binary. In a packaged app that binary is resolved to a path
 * inside `app.asar`, and Electron redirects `execFile` — not `spawn`, which
 * esbuild uses — to the unpacked copy, so the spawn fails with ENOENT. esbuild
 * reads `ESBUILD_BINARY_PATH` when its module is evaluated, so this module
 * must be the first import of the main entry, ahead of anything that pulls
 * esbuild or mdx-bundler in. Outside an asar the resolved path is used as-is
 * and nothing is set. `electron-builder.config.ts` unpacks `@esbuild/**`.
 */
function resolvePlatformBinary(): string {
  const require = createRequire(import.meta.url);
  const packageName = `@esbuild/${process.platform}-${process.arch}`;
  const binaryFile = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  return require.resolve(`${packageName}/${binaryFile}`);
}

if (!process.env.ESBUILD_BINARY_PATH) {
  const unpacked = unpackedAsarPath(resolvePlatformBinary());
  if (unpacked) process.env.ESBUILD_BINARY_PATH = unpacked;
}
