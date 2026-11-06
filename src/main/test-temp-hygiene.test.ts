import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Suites that made a temp folder per case and never removed it left 582
 * `chord-catfile-*` and 386 `chord-user-bin-*` folders in TEMP (devstation-i3y5.5).
 * They run here in a child vitest whose TEMP is a folder of its own, so a folder
 * one of them leaves behind is seen, whichever case made it, and the user's TEMP
 * is never read.
 */
const SUITES = ['src/main/core/git/impl/cat-file-batch.test.ts', 'src/main/utils/userEnv.test.ts'];
const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VITEST = path.join(APP_ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-hygiene-'));

afterAll(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

/**
 * This worker's environment without its vitest variables, which would make the
 * child a worker, and without colour: CI sets `CI`, which colours the child's
 * report, and its summary is read below as text.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^VITEST/i.test(key) && key !== 'NODE_OPTIONS') env[key] = value;
  }
  return { ...env, NO_COLOR: '1', FORCE_COLOR: '0', TMP: temp, TEMP: temp, TMPDIR: temp };
}

describe('temp folders of the main-process suites', () => {
  it('leaves no chord- folder in TEMP after the cat-file and user-env suites', () => {
    const child = spawnSync(process.execPath, [VITEST, 'run', '--project', 'node', ...SUITES], {
      cwd: APP_ROOT,
      env: childEnv(),
      encoding: 'utf8',
      timeout: 120_000,
    });

    expect(child.status, `${child.stdout}${child.stderr}`).toBe(0);
    expect(`${child.stdout}`).toMatch(/Test Files {2}2 passed \(2\)/);
    expect(fs.readdirSync(temp).filter((name) => name.startsWith('chord-'))).toEqual([]);
  }, 150_000);
});
