import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * A published version is attributed to the signed-in account, like every
 * other saved version (`saveVersion`, in-place edits). With nobody signed in
 * the publish is refused, loudly, before anything is written — never saved
 * under a placeholder author and never saved without its version.
 * Real SQLite from the shipped migrations; no account is stored.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { syncQueue } = await import('@main/db/schema-sync');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts, artifactVersions } = await import('@main/db/schema-artifacts');
const { configureArtifactRuntimeDir } = await import(
  '@main/core/artifact-pages/artifact-runtime-dir'
);
const { artifactsController } = await import('@main/core/artifacts/controller');
const { publishArtifact } = await import('./publish-artifact');

let root: string;
let repoDir: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'chord-publish-signed-out-'));
  repoDir = join(root, 'repo');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  for (const name of ['tokens.css', 'chord-page.js', 'components.css', 'runtime-standalone.js']) {
    writeFileSync(join(runtimeDir, name), `/* ${name} */`);
  }
  configureArtifactRuntimeDir(runtimeDir);
  writeFileSync(join(repoDir, 'plan.md'), '# Plan');
  writeFileSync(join(repoDir, 'page.html'), '<html><body>page</body></html>');

  await db.insert(repos).values({ id: 'r-signed-out', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: 'w-signed-out',
    repoId: 'r-signed-out',
    repoPath: repoDir,
    name: 'Signed out',
  });
});

afterAll(() => {
  removeDirSync(root);
});

describe('publishArtifact — signed out', () => {
  it.each(['plan.md', 'page.html'])('refuses to publish %s and writes nothing', async (path) => {
    await expect(
      publishArtifact({ sessionId: 's-out', workItemId: 'w-signed-out', cwd: repoDir }, { path })
    ).rejects.toThrow('Sign in to Chord to publish — versions are attributed to your account.');
    expect(db.select().from(artifacts).all()).toEqual([]);
    expect(db.select().from(artifactVersions).all()).toEqual([]);
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });
});

describe('artifacts.create ("Add to artifacts") — signed out', () => {
  it('refuses with no_identity and writes nothing, exactly as publish does', async () => {
    const result = await artifactsController.create({
      workItemId: 'w-signed-out',
      filePath: join(repoDir, 'page.html'),
      name: 'page.html',
      type: 'web',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'no_identity' });
    expect(db.select().from(artifacts).all()).toEqual([]);
    expect(db.select().from(artifactVersions).all()).toEqual([]);
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });
});
