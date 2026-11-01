import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { reposController } from './controller';

/**
 * `repos.listRemotes` (shared-items step 3, H7): the normalized origin of every
 * repo on this machine, so a teammate's shared item can join the user's own
 * group for the same repo. Driven through real git repositories on disk and a
 * real SQLite database built from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const execFileAsync = promisify(execFile);

let workDir = '';

async function makeGitRepo(name: string, origin: string | null): Promise<string> {
  const path = join(workDir, name);
  await execFileAsync('git', ['init', path]);
  if (origin) await execFileAsync('git', ['remote', 'add', 'origin', origin], { cwd: path });
  return path;
}

async function listRemotes() {
  const result = await reposController.listRemotes();
  if (!result.success) throw new Error('listRemotes failed');
  return [...result.data.remotes].sort((a, b) => a.repoId.localeCompare(b.repoId));
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'chord-list-remotes-'));
  await db.delete(repos);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('repos.listRemotes', () => {
  it("gives each repo's origin in the normalized form the cloud stores", async () => {
    await db.insert(repos).values([
      {
        id: 'r1',
        alias: 'chord',
        path: await makeGitRepo('chord', 'git@github.com:Acme/Chord.git'),
      },
      {
        id: 'r2',
        alias: 'web',
        path: await makeGitRepo('web', 'https://github.com/acme/chord-web'),
      },
    ]);

    expect(await listRemotes()).toEqual([
      { repoId: 'r1', alias: 'chord', remoteUrl: 'github.com/acme/chord' },
      { repoId: 'r2', alias: 'web', remoteUrl: 'github.com/acme/chord-web' },
    ]);
  });

  it('has no remote for a repo without an origin, or whose folder is gone', async () => {
    await db.insert(repos).values([
      { id: 'r1', alias: 'local-only', path: await makeGitRepo('local-only', null) },
      { id: 'r2', alias: 'moved', path: join(workDir, 'no-such-folder') },
    ]);

    expect(await listRemotes()).toEqual([
      { repoId: 'r1', alias: 'local-only', remoteUrl: null },
      { repoId: 'r2', alias: 'moved', remoteUrl: null },
    ]);
  });

  it('includes archived repos: their work items still sit in their group', async () => {
    await db.insert(repos).values({
      id: 'r1',
      alias: 'old',
      path: await makeGitRepo('old', 'git@github.com:acme/old.git'),
      archivedAt: 1,
    });

    expect(await listRemotes()).toEqual([
      { repoId: 'r1', alias: 'old', remoteUrl: 'github.com/acme/old' },
    ]);
  });
});
