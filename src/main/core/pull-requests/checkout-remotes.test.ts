import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readCheckoutRemotes } from './checkout-remotes';

// Same length on purpose: the cache test restores the config's size as well
// as its mtime, so only a cached read can return the old URL.
const URL_A = 'https://github.com/acme/chord-a.git';
const URL_B = 'https://github.com/acme/chord-b.git';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

let root: string;
let repo: string;
let configPath: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-checkout-remotes-'));
  repo = path.join(root, 'chord');
  fs.mkdirSync(repo);
  await git(['init', '-q', '-b', 'main'], repo);
  await git(['config', 'user.email', 'test@chord.invalid'], repo);
  await git(['config', 'user.name', 'Chord test'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# chord\n');
  await git(['add', 'README.md'], repo);
  await git(['commit', '-q', '-m', 'readme'], repo);
  await git(['remote', 'add', 'origin', URL_A], repo);
  configPath = path.join(repo, '.git', 'config');
});

afterEach(() => {
  removeDirSync(root);
});

/** Moves the config's mtime well past the last read, so the change is seen whatever the clock resolution. */
function touchConfigForward(): void {
  const later = new Date(fs.statSync(configPath).mtimeMs + 10_000);
  fs.utimesSync(configPath, later, later);
}

describe('readCheckoutRemotes — remotes are read once per clone config', () => {
  it("reads the checkout's GitHub repository and remote names", async () => {
    expect(await readCheckoutRemotes(repo)).toEqual({
      names: ['origin'],
      repositoryUrl: 'https://github.com/acme/chord-a',
    });
  });

  it('serves the last read while the config file is unchanged — no git runs', async () => {
    // A whole-second mtime, so it can be put back exactly: utimes takes
    // milliseconds, and NTFS keeps 100ns ticks a restore would not match.
    const pinned = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    fs.utimesSync(configPath, pinned, pinned);
    await readCheckoutRemotes(repo);
    const sizeBefore = fs.statSync(configPath).size;

    await git(['remote', 'set-url', 'origin', URL_B], repo);
    // Same size (equal-length URLs) and the old mtime: to the cache, unchanged.
    expect(fs.statSync(configPath).size).toBe(sizeBefore);
    fs.utimesSync(configPath, pinned, pinned);

    expect((await readCheckoutRemotes(repo)).repositoryUrl).toBe('https://github.com/acme/chord-a');
  });

  it('reads git again once the config file changes', async () => {
    await readCheckoutRemotes(repo);

    await git(['remote', 'set-url', 'origin', URL_B], repo);
    touchConfigForward();

    expect((await readCheckoutRemotes(repo)).repositoryUrl).toBe('https://github.com/acme/chord-b');
  });

  it("shares one entry across a clone's worktrees: a change in the main checkout is seen from a lane", async () => {
    const lane = path.join(root, 'lane');
    await git(['worktree', 'add', '-q', '-b', 'lane', lane], repo);
    expect((await readCheckoutRemotes(lane)).repositoryUrl).toBe('https://github.com/acme/chord-a');

    await git(['remote', 'set-url', 'origin', URL_B], repo);
    touchConfigForward();

    expect((await readCheckoutRemotes(lane)).repositoryUrl).toBe('https://github.com/acme/chord-b');
  });
});
