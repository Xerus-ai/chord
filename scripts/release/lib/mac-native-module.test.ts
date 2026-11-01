import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NATIVE_MODULES } from './config.ts';
import { macNativeModule } from './mac-native-module.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('macNativeModule', () => {
  const app = join('release', 'mac-arm64', 'Chord.app');
  const native = macNativeModule(app);

  it('is a native module the app ships, rebuilt per arch', () => {
    expect(NATIVE_MODULES).toContain(native.name);
  });

  it("is that module's binary under the app's unpacked asar", () => {
    const unpacked = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
    expect(native.path.startsWith(join(unpacked, native.name))).toBe(true);
    // The same file in this checkout's install: the name is the one the module builds.
    const installed = join(ROOT, 'node_modules', native.path.slice(unpacked.length + 1));
    expect(existsSync(installed)).toBe(true);
  });
});
