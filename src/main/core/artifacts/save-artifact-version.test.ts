import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Version conflicts (plan 2026-09-23 §4 P4 step 3): a save names the version
 * it was made on top of, and a save on a stale base is refused instead of
 * interleaving silently. Real SQLite from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts, artifactVersions } = await import('@main/db/schema-artifacts');
const { insertArtifactVersion } = await import('./save-artifact-version');

const ARTIFACT_ID = 'a-versions';

function save(baseVersion: number | null, content: string) {
  return insertArtifactVersion({
    artifactId: ARTIFACT_ID,
    content,
    trigger: 'manual',
    authorName: 'tester',
    baseVersion,
  });
}

beforeAll(async () => {
  await db.insert(repos).values({ id: 'r-versions', alias: 'repo', path: '/tmp/versions' });
  await db.insert(workItems).values({
    id: 'w-versions',
    repoId: 'r-versions',
    repoPath: '/tmp/versions',
    name: 'Versions',
  });
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    workItemId: 'w-versions',
    filePath: '/tmp/versions/plan.md',
    name: 'plan.md',
  });
});

beforeEach(() => {
  db.delete(artifactVersions).run();
});

describe('insertArtifactVersion — baseVersion', () => {
  it('saves on top of the latest version and numbers it next', () => {
    const first = save(0, 'one');
    expect(first).toMatchObject({ status: 'saved', version: { versionNumber: 1 } });
    const second = save(1, 'two');
    expect(second).toMatchObject({ status: 'saved', version: { versionNumber: 2 } });
  });

  it('two saves made on the same version: the second gets conflict and stores nothing', () => {
    save(0, 'base');
    const mine = save(1, 'mine');
    const theirs = save(1, 'theirs');

    expect(mine).toMatchObject({ status: 'saved', version: { versionNumber: 2 } });
    expect(theirs).toEqual({ status: 'conflict', latestVersion: 2 });
    const rows = db.select().from(artifactVersions).all();
    expect(rows.map((r) => r.content).sort()).toEqual(['base', 'mine']);
  });

  it('a base ahead of the history is a conflict too', () => {
    save(0, 'base');
    expect(save(5, 'future')).toEqual({ status: 'conflict', latestVersion: 1 });
  });

  it('a null base appends unconditionally (in-place edits are per-element last-write-wins)', () => {
    save(0, 'base');
    save(1, 'next');
    expect(save(null, 'edit')).toMatchObject({ status: 'saved', version: { versionNumber: 3 } });
  });
});
