import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The test config reads no `.env` file (devstation-mg6u.60). Vite loads the VITE_ variables of a
 * `.env` in its env folder, and vitest copies them onto process.env for every test. A writer has
 * the main app's `.env` copied in and CI has none, so a test that leaned on one passed gate verify
 * and failed CI (PR #32). Values tests need are pinned in vitest.config.ts instead.
 */
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('vitest.config.ts', () => {
  it('loads no VITE_ variable from a .env file, so a tree with one runs like CI', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vitest-env-'));
    writeFileSync(join(dir, '.env'), 'VITE_PROBE_FROM_ENV_FILE=leaked\n');

    const config = await resolveConfig(
      { configFile: resolve(__dirname, '..', 'vitest.config.ts'), root: dir, logLevel: 'silent' },
      'serve',
      'test'
    );

    expect(config.env.VITE_PROBE_FROM_ENV_FILE).toBeUndefined();
  });
});
