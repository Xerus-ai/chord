import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from 'dotenv';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A release build's baked sign-in and cloud addresses (packaged-env.ts; electron.vite.config.ts
 * defines __CHORD_PACKAGED_ENV__ from scripts/release/lib/build-env.ts). The module runs at
 * import, before dotenv, so these cases import it the way src/main/index.ts does.
 */
const NAMES = ['CHORD_PACKAGED_ENV_TEST_A', 'CHORD_PACKAGED_ENV_TEST_B'];
const temps: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  for (const name of NAMES) delete process.env[name];
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function importWithBaked(baked: Record<string, string>): Promise<void> {
  vi.stubGlobal('__CHORD_PACKAGED_ENV__', baked);
  vi.resetModules();
  await import('./packaged-env');
}

describe('packaged-env', () => {
  it('puts the baked addresses into process.env for the main process', async () => {
    await importWithBaked({ CHORD_PACKAGED_ENV_TEST_A: 'https://api.example.test' });

    expect(process.env.CHORD_PACKAGED_ENV_TEST_A).toBe('https://api.example.test');
  });

  it('leaves a variable the launch environment already set', async () => {
    process.env.CHORD_PACKAGED_ENV_TEST_B = 'https://from-the-shell.test';

    await importWithBaked({
      CHORD_PACKAGED_ENV_TEST_A: 'https://api.example.test',
      CHORD_PACKAGED_ENV_TEST_B: 'https://baked.test',
    });

    expect(process.env.CHORD_PACKAGED_ENV_TEST_A).toBe('https://api.example.test');
    expect(process.env.CHORD_PACKAGED_ENV_TEST_B).toBe('https://from-the-shell.test');
  });

  it('a stray .env loaded after it cannot repoint a baked address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'packaged-env-'));
    temps.push(dir);
    const dotenvFile = join(dir, '.env');
    writeFileSync(dotenvFile, 'CHORD_PACKAGED_ENV_TEST_A=https://stray.test\n');

    await importWithBaked({ CHORD_PACKAGED_ENV_TEST_A: 'https://api.example.test' });
    config({ path: dotenvFile, quiet: true });

    expect(process.env.CHORD_PACKAGED_ENV_TEST_A).toBe('https://api.example.test');
  });

  it('a development build bakes nothing and changes nothing', async () => {
    await importWithBaked({});

    expect(NAMES.map((name) => process.env[name])).toEqual([undefined, undefined]);
  });
});
