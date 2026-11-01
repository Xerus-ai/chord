import { join } from 'node:path';

/**
 * The native module verify-mac.ts checks the arch of: better-sqlite3, rebuilt per arch by
 * rebuild-native.ts (NATIVE_MODULES) and unpacked from the asar so it can load.
 */
export function macNativeModule(appDir: string): { name: string; path: string } {
  const name = 'better-sqlite3';
  const path = join(
    appDir,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    name,
    'build',
    'Release',
    'better_sqlite3.node'
  );
  return { name, path };
}
