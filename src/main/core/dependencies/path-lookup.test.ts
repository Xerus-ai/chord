import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCommandOnPath } from './path-lookup';

/**
 * Resolving a dependency's binary reads PATH in-process instead of spawning
 * `where` / `which`: nine spawns at boot held the main thread ~240ms before
 * the window was created (measured 2026-10-15, scripts/perf/bench-startup.mjs).
 * The lookup must pick what the shell would run, in real directories.
 */
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chord-path-lookup-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function dir(name: string, files: string[]): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  // Executable, as an installed command is: the POSIX lookup requires it.
  for (const file of files) writeFileSync(join(path, file), '', { mode: 0o755 });
  return path;
}

const PATHEXT = '.COM;.EXE;.BAT;.CMD';

describe('findCommandOnPath — Windows', () => {
  it('skips the extensionless npm script and returns the runnable launcher beside it', async () => {
    const npm = dir('npm', ['claude', 'claude.cmd', 'claude.ps1']);

    const found = await findCommandOnPath('claude', {
      path: npm,
      pathExt: PATHEXT,
      platform: 'win32',
    });

    expect(found).toBe(join(npm, 'claude.cmd'));
  });

  it('takes the first PATH directory that has the command', async () => {
    const empty = dir('empty', []);
    const first = dir('first', ['git.exe']);
    const second = dir('second', ['git.exe']);

    const found = await findCommandOnPath('git', {
      path: [empty, first, second].join(';'),
      pathExt: PATHEXT,
      platform: 'win32',
    });

    expect(found).toBe(join(first, 'git.exe'));
  });

  it('prefers the PATHEXT order within one directory', async () => {
    const both = dir('both', ['tool.cmd', 'tool.exe']);

    const found = await findCommandOnPath('tool', {
      path: both,
      pathExt: PATHEXT,
      platform: 'win32',
    });

    expect(found).toBe(join(both, 'tool.exe'));
  });

  it('ignores a directory that only has the name as a folder', async () => {
    const decoy = dir('decoy', []);
    mkdirSync(join(decoy, 'node.exe'));
    const real = dir('real', ['node.exe']);

    const found = await findCommandOnPath('node', {
      path: `"${decoy}";${real}`,
      pathExt: PATHEXT,
      platform: 'win32',
    });

    expect(found).toBe(join(real, 'node.exe'));
  });

  it('returns null when no directory has a runnable match', async () => {
    const npm = dir('npm', ['codex']);

    const found = await findCommandOnPath('codex', {
      path: npm,
      pathExt: PATHEXT,
      platform: 'win32',
    });

    expect(found).toBeNull();
  });

  it('throws when PATHEXT is missing, since nothing can be called runnable', async () => {
    await expect(
      findCommandOnPath('git', { path: root, pathExt: undefined, platform: 'win32' })
    ).rejects.toThrow('PATHEXT');
  });
});

// A POSIX PATH is colon-separated, so it cannot carry this host's directories
// when they are Windows paths (`C:\…`): these run where POSIX paths are real.
describe.runIf(process.platform !== 'win32')('findCommandOnPath — POSIX', () => {
  it('returns the first directory holding a file of that exact name', async () => {
    const first = dir('bin1', ['gh']);
    const second = dir('bin2', ['gh']);

    const found = await findCommandOnPath('gh', {
      path: [first, second].join(':'),
      pathExt: undefined,
      platform: 'linux',
    });

    expect(found).toBe(join(first, 'gh'));
  });

  it('returns null when the command is on no PATH directory', async () => {
    const bin = dir('bin', ['other']);

    const found = await findCommandOnPath('gh', {
      path: bin,
      pathExt: undefined,
      platform: 'darwin',
    });

    expect(found).toBeNull();
  });
});
