import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Restore (shared-items step 1, S7): an older version of a page or file
 * becomes the newest, as a manual save labelled "Restored vN", and the file
 * on disk is put back to it. Real SQLite from the shipped migrations, real
 * files, the real view builders.
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
const { insertArtifactVersion } = await import('./save-artifact-version');
const { restoreArtifactVersion } = await import('./restore-artifact-version');

const WORK_ITEM_ID = 'w-restore';
const PAGE_ID = 'a-restore-page';
const IMAGE_ID = 'a-restore-image';
const DOCUMENT_ID = 'a-restore-doc';
const AUTHOR = 'ada@example.com';

const PAGE_V1 = '<html><head></head><body><p>first draft</p></body></html>';
const PAGE_V2 = '<html><head></head><body><p>second draft</p></body></html>';
const PNG_V1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 1, 1]);
const PNG_V2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2, 2, 2]);

let root: string;
let pagePath: string;
let imagePath: string;

function versionsOf(artifactId: string) {
  return db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .all()
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

function seedVersion(artifactId: string, content: string) {
  const result = insertArtifactVersion({
    artifactId,
    content,
    trigger: 'agent_milestone',
    authorName: AUTHOR,
    baseVersion: null,
  });
  if (result.status !== 'saved') throw new Error('seeding a version conflicted');
  return result.version;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'chord-restore-'));
  const repoDir = join(root, 'repo');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), ':root{}');
  writeFileSync(join(runtimeDir, 'chord-page.js'), '/*BRIDGE*/');
  writeFileSync(join(runtimeDir, 'components.css'), '/*COMPONENTS*/');
  writeFileSync(join(runtimeDir, 'runtime-standalone.js'), 'window.React={};');
  writeFileSync(join(runtimeDir, 'mermaid-standalone.js'), '/*MERMAID*/');
  configureArtifactRuntimeDir(runtimeDir);

  pagePath = join(repoDir, 'index.html');
  imagePath = join(repoDir, 'logo.png');
  writeFileSync(join(repoDir, 'plan.md'), '# Plan');

  await db.insert(repos).values({ id: 'r-restore', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-restore',
    repoPath: repoDir,
    name: 'Restoring',
  });
  await db.insert(artifacts).values([
    {
      id: PAGE_ID,
      workItemId: WORK_ITEM_ID,
      filePath: pagePath,
      name: 'index.html',
      type: 'web',
      contentType: 'web',
    },
    {
      id: IMAGE_ID,
      workItemId: WORK_ITEM_ID,
      filePath: imagePath,
      name: 'logo.png',
      type: 'image',
      contentType: 'image',
    },
    {
      id: DOCUMENT_ID,
      workItemId: WORK_ITEM_ID,
      filePath: join(repoDir, 'plan.md'),
      name: 'plan.md',
      type: 'markdown',
      contentType: 'markdown',
    },
  ]);
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(() => {
  db.delete(artifactVersions).run();
  db.delete(syncQueue).run();
  writeFileSync(pagePath, PAGE_V2);
  writeFileSync(imagePath, PNG_V2);
});

describe('restoreArtifactVersion — a page', () => {
  it('saves exactly one new version, labelled and manual, with the restored content', async () => {
    const v1 = seedVersion(PAGE_ID, PAGE_V1);
    seedVersion(PAGE_ID, PAGE_V2);

    const result = await restoreArtifactVersion({
      artifactId: PAGE_ID,
      versionId: v1.id,
      baseVersion: 2,
      authorName: AUTHOR,
    });

    expect(result.status).toBe('saved');
    const rows = versionsOf(PAGE_ID);
    expect(rows.map((row) => row.versionNumber)).toEqual([1, 2, 3]);
    expect(rows[2]).toMatchObject({
      content: PAGE_V1,
      trigger: 'manual',
      label: 'Restored v1',
      authorName: AUTHOR,
    });
  });

  it('puts the file on disk back to the restored content', async () => {
    const v1 = seedVersion(PAGE_ID, PAGE_V1);
    seedVersion(PAGE_ID, PAGE_V2);
    await restoreArtifactVersion({
      artifactId: PAGE_ID,
      versionId: v1.id,
      baseVersion: 2,
      authorName: AUTHOR,
    });
    expect(readFileSync(pagePath, 'utf-8')).toBe(PAGE_V1);
  });

  it('queues the restore for upload like a manual save, with its view', async () => {
    const v1 = seedVersion(PAGE_ID, PAGE_V1);
    seedVersion(PAGE_ID, PAGE_V2);
    db.delete(syncQueue).run();
    await restoreArtifactVersion({
      artifactId: PAGE_ID,
      versionId: v1.id,
      baseVersion: 2,
      authorName: AUTHOR,
    });
    const uploads = db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.entityType, 'artifact_version_upload'))
      .all()
      .map((row) => JSON.parse(row.payload) as Record<string, unknown>);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ trigger: 'manual', label: 'Restored v1', content: PAGE_V1 });
    expect(typeof uploads[0].view_html).toBe('string');
  });

  it('is a conflict, writing nothing, when a newer version landed after the card opened', async () => {
    const v1 = seedVersion(PAGE_ID, PAGE_V1);
    seedVersion(PAGE_ID, PAGE_V2);

    const result = await restoreArtifactVersion({
      artifactId: PAGE_ID,
      versionId: v1.id,
      baseVersion: 1,
      authorName: AUTHOR,
    });

    expect(result).toEqual({ status: 'conflict', latestVersion: 2 });
    expect(versionsOf(PAGE_ID)).toHaveLength(2);
    expect(readFileSync(pagePath, 'utf-8')).toBe(PAGE_V2);
  });
});

describe('restoreArtifactVersion — a file', () => {
  it("writes the version's bytes back and saves them as the newest version", async () => {
    const v1 = seedVersion(IMAGE_ID, PNG_V1.toString('base64'));
    seedVersion(IMAGE_ID, PNG_V2.toString('base64'));

    const result = await restoreArtifactVersion({
      artifactId: IMAGE_ID,
      versionId: v1.id,
      baseVersion: 2,
      authorName: AUTHOR,
    });

    expect(result.status).toBe('saved');
    expect(readFileSync(imagePath).equals(PNG_V1)).toBe(true);
    const rows = versionsOf(IMAGE_ID);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ content: PNG_V1.toString('base64'), label: 'Restored v1' });
  });
});

describe('restoreArtifactVersion — refusals', () => {
  it('refuses a document: it is restored through its live editor', async () => {
    const v1 = seedVersion(DOCUMENT_ID, '# Old plan');
    await expect(
      restoreArtifactVersion({
        artifactId: DOCUMENT_ID,
        versionId: v1.id,
        baseVersion: 1,
        authorName: AUTHOR,
      })
    ).rejects.toThrow(/editor/);
  });

  it("refuses a version that is not this artifact's", async () => {
    const other = seedVersion(IMAGE_ID, PNG_V1.toString('base64'));
    await expect(
      restoreArtifactVersion({
        artifactId: PAGE_ID,
        versionId: other.id,
        baseVersion: 0,
        authorName: AUTHOR,
      })
    ).rejects.toThrow(/not a version of/);
  });
});
