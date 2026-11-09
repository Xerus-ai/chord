import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Since Electron 42 the `electron` package has no postinstall script: the binary arrives only when
 * something runs its `install.js` (the `install-electron` bin). `scripts/postinstall.ts` runs it,
 * so `pnpm install` alone must leave a runnable binary. The binary is found the way
 * `electron/index.js` finds it (`path.txt` under `dist/`), without requiring `electron`: its
 * `index.js` downloads lazily on first require, which would hide a missing install.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');

describe('electron install', () => {
  it('pnpm install leaves a runnable Electron 45.2.1 on ABI 150', () => {
    const pathFile = path.join(ELECTRON_DIR, 'path.txt');
    expect(existsSync(pathFile), `${pathFile} is missing: install.js did not run`).toBe(true);
    const binary = path.join(ELECTRON_DIR, 'dist', readFileSync(pathFile, 'utf8').trim());
    expect(existsSync(binary), `${binary} is missing`).toBe(true);

    const run = spawnSync(
      binary,
      ['-p', "process.versions.electron + ' ' + process.versions.modules"],
      {
        encoding: 'utf8',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 60_000,
      }
    );
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe('45.2.1 150');
  });
});
