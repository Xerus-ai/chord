import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPO_ICON_KEYS, serializeRepoIcon, type RepoIcon } from '@shared/repo-icons';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { reposController } from './controller';

/**
 * Drives the REAL repos controller against a REAL SQLite database built from
 * the shipped migrations. Nothing about `setIcon` can be proved by reading it:
 * the column has to exist in the physical table, the guard has to reject a
 * shape the picker could never send, and "unknown repo" has to be an error
 * rather than a silent no-op — an UPDATE that matches no row succeeds in SQLite.
 *
 * `detectIcon` is driven against real directories: an absent path is a probe
 * that could not complete (`failed`, column stays NULL so the next launch
 * retries) and a real empty folder with no git remote is a probe that ran and
 * found nothing (`none`, column settles on the letter tile).
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const [FIRST_KEY, SECOND_KEY] = REPO_ICON_KEYS;
const FIRST_ICON: RepoIcon = { type: 'lucide', key: FIRST_KEY };
const SECOND_ICON: RepoIcon = { type: 'lucide', key: SECOND_KEY };

const PNG_DATA_URI = `data:image/png;base64,${Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
).toString('base64')}`;

let emptyRepoPath = '';

async function seedRepo(id: string, alias: string, path = `/tmp/${id}`): Promise<void> {
  await db.insert(repos).values({ id, path, alias });
}

async function iconOf(id: string): Promise<RepoIcon | null | undefined> {
  const result = await reposController.getAll();
  if (!result.success) throw new Error('getAll failed');
  return result.data.repos.find((repo) => repo.id === id)?.icon;
}

async function rawIconOf(id: string): Promise<string | null | undefined> {
  const [row] = await db.select({ icon: repos.icon }).from(repos).where(eq(repos.id, id)).limit(1);
  return row?.icon;
}

beforeEach(async () => {
  emptyRepoPath = await mkdtemp(join(tmpdir(), 'chord-repo-controller-'));
  await db.delete(repos);
  await seedRepo('r1', 'alpha');
  await seedRepo('r2', 'beta');
});

afterEach(async () => {
  await rm(emptyRepoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('repos.setIcon', () => {
  it('starts every repo with no icon, so detection is still owed', async () => {
    expect(await iconOf('r1')).toBeNull();
    expect(await rawIconOf('r1')).toBeNull();
  });

  it('round-trips a chosen lucide icon through getAll without touching its neighbour', async () => {
    const result = await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });

    expect(result.success).toBe(true);
    expect(await iconOf('r1')).toEqual(FIRST_ICON);
    expect(await iconOf('r2')).toBeNull();
  });

  it('stores the icon as JSON, not as a bare key', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });

    expect(JSON.parse((await rawIconOf('r1')) ?? '')).toEqual(FIRST_ICON);
  });

  it('replaces a previously chosen icon', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });
    await reposController.setIcon({ id: 'r1', icon: SECOND_ICON });

    expect(await iconOf('r1')).toEqual(SECOND_ICON);
  });

  it('settles on the letter tile rather than clearing the column, so it is not re-probed', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });
    await reposController.setIcon({ id: 'r1', icon: { type: 'letter' } });

    expect(await iconOf('r1')).toEqual({ type: 'letter' });
    expect(await rawIconOf('r1')).not.toBeNull();
  });

  it('refuses an image — the renderer has no upload path and may not open one', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });

    await expect(
      reposController.setIcon({
        id: 'r1',
        icon: { type: 'image', src: PNG_DATA_URI, source: 'file' } as never,
      })
    ).rejects.toThrow(/image/i);
    expect(await iconOf('r1')).toEqual(FIRST_ICON);
  });

  it('refuses a key that is not in the shared list, and writes nothing', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });

    await expect(
      reposController.setIcon({ id: 'r1', icon: { type: 'lucide', key: 'FolderIcon' as never } })
    ).rejects.toThrow(/icon/i);
    expect(await iconOf('r1')).toEqual(FIRST_ICON);
  });

  it('refuses a repo id that does not exist rather than silently matching no row', async () => {
    await expect(reposController.setIcon({ id: 'no-such-repo', icon: FIRST_ICON })).rejects.toThrow(
      /no-such-repo/
    );
  });
});

describe('repos.getAll icon parsing', () => {
  it('parses every stored variant', async () => {
    await db
      .update(repos)
      .set({ icon: serializeRepoIcon({ type: 'image', src: PNG_DATA_URI, source: 'github' }) })
      .where(eq(repos.id, 'r1'));
    await db
      .update(repos)
      .set({ icon: serializeRepoIcon({ type: 'letter' }) })
      .where(eq(repos.id, 'r2'));

    expect(await iconOf('r1')).toEqual({ type: 'image', src: PNG_DATA_URI, source: 'github' });
    expect(await iconOf('r2')).toEqual({ type: 'letter' });
  });

  it('throws on a column value it cannot read rather than quietly drawing a letter', async () => {
    await db.update(repos).set({ icon: 'folder' }).where(eq(repos.id, 'r1'));

    await expect(reposController.getAll()).rejects.toThrow(/repo icon/i);
  });
});

describe('repos.detectIcon', () => {
  it('persists the letter tile when the probe ran and found nothing', async () => {
    await seedRepo('r3', 'gamma', emptyRepoPath);

    const result = await reposController.detectIcon({ id: 'r3' });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('detectIcon failed');
    expect(result.data.outcome).toEqual({ kind: 'none' });
    expect(await iconOf('r3')).toEqual({ type: 'letter' });
  });

  it('persists nothing when the probe could not complete, so the next launch retries', async () => {
    const result = await reposController.detectIcon({ id: 'r1' });

    if (!result.success) throw new Error('detectIcon failed');
    expect(result.data.outcome.kind).toBe('failed');
    expect(await rawIconOf('r1')).toBeNull();
  });

  it('leaves an already-chosen icon alone when the probe could not complete', async () => {
    await reposController.setIcon({ id: 'r1', icon: FIRST_ICON });

    await reposController.detectIcon({ id: 'r1' });

    expect(await iconOf('r1')).toEqual(FIRST_ICON);
  });

  it('persists a detected image icon', async () => {
    await writeFile(
      join(emptyRepoPath, 'favicon.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    await seedRepo('r4', 'delta', emptyRepoPath);

    const result = await reposController.detectIcon({ id: 'r4' });

    if (!result.success) throw new Error('detectIcon failed');
    expect(result.data.outcome.kind).toBe('found');
    expect(await iconOf('r4')).toEqual({ type: 'image', src: PNG_DATA_URI, source: 'file' });
  });

  it('refuses a repo id that does not exist', async () => {
    await expect(reposController.detectIcon({ id: 'no-such-repo' })).rejects.toThrow(
      /no-such-repo/
    );
  });
});
