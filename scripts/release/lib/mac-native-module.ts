import { join } from 'node:path';

/**
 * The native module verify-mac.ts checks the arch of: node-pty, rebuilt per arch by
 * rebuild-native.ts (NATIVE_MODULES) and unpacked from the asar so it can load. better-sqlite3
 * is not it: since 13 it loads the N-API prebuild it ships for each platform.
 */
export function macNativeModule(appDir: string): { name: string; path: string } {
  const name = 'node-pty';
  const path = join(
    appDir,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    name,
    'build',
    'Release',
    'pty.node'
  );
  return { name, path };
}
