import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  HOST_NPM_PLATFORM_ARGS,
  HOST_NPM_PLATFORM_SHELL_PREFIX,
  withHostNpmPlatform,
} from './npm-host-platform';

// A user npmrc that pins another platform, as `os=linux` on a Windows machine
// did: npm then fetches the wrong native binaries for global agent installs.
const foreignOs = process.platform === 'linux' ? 'darwin' : 'linux';
const dir = mkdtempSync(join(tmpdir(), 'npm-host-platform-'));
const userconfig = join(dir, '.npmrc');
writeFileSync(userconfig, `os=${foreignOs}\ncpu=ia32\n`);
// Free of whatever npm config the test runner itself was started with.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key))
);
const userEnv = { ...cleanEnv, npm_config_userconfig: userconfig };
// npm and pnpm export config to the processes they start, in either case —
// the case Chord's own dev process was seen to inherit it in.
const exportedEnv = { ...userEnv, NPM_CONFIG_OS: foreignOs, NPM_CONFIG_CPU: 'ia32' };

function readNpmConfig(env: NodeJS.ProcessEnv, args: string[] = []): string[] {
  return ['os', 'cpu'].map((key) =>
    execSync(['npm', 'config', 'get', key, ...args].join(' '), { env, encoding: 'utf-8' }).trim()
  );
}

afterAll(() => removeDirSync(dir));

describe('the foreign-platform fixture', () => {
  it('pins npm to another platform on its own', () => {
    expect(readNpmConfig(userEnv)).toEqual([foreignOs, 'ia32']);
    expect(readNpmConfig(exportedEnv)).toEqual([foreignOs, 'ia32']);
  });
});

describe('withHostNpmPlatform', () => {
  it("overrides the user's npmrc with this machine's os and cpu", () => {
    expect(readNpmConfig(withHostNpmPlatform(userEnv))).toEqual([process.platform, process.arch]);
  });

  it('overrides an inherited export whatever its case', () => {
    expect(readNpmConfig(withHostNpmPlatform(exportedEnv))).toEqual([
      process.platform,
      process.arch,
    ]);
  });
});

describe('HOST_NPM_PLATFORM_ARGS', () => {
  it('outrank both the npmrc and inherited exports', () => {
    expect(readNpmConfig(exportedEnv, HOST_NPM_PLATFORM_ARGS)).toEqual([
      process.platform,
      process.arch,
    ]);
  });
});

describe('HOST_NPM_PLATFORM_SHELL_PREFIX', () => {
  it("pins npm to the platform of the shell host's node", () => {
    // `sh`, not `bash`: on Windows `bash` can resolve to WSL, a different host.
    const output = execFileSync(
      'sh',
      ['-c', `${HOST_NPM_PLATFORM_SHELL_PREFIX}npm config get os; npm config get cpu`],
      { env: exportedEnv, encoding: 'utf-8' }
    );
    expect(output.trim().split(/\r?\n/)).toEqual([process.platform, process.arch]);
  });
});
