import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * The person-driven ways a local version is made — "Add to artifacts"
 * (`artifacts.create`, which publishes exactly as publish_artifact does), Save
 * in the artifact toolbar (`artifacts.saveVersion`) and an in-place text edit
 * on a web page (`artifactPages.commitTextEdit`) — queue the same upload
 * publish does (design 2026-09-24 §9 "Upload"). Real SQLite, real files; the signed-in
 * account goes through the real account path (`_testing/test-account.ts`).
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { syncQueue } = await import('@main/db/schema-sync');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts, artifactVersions } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { configureArtifactRuntimeDir } = await import(
  '@main/core/artifact-pages/artifact-runtime-dir'
);
const { stampChordIds } = await import('@main/core/artifact-pages/page-element-ids');
const { loadParse5 } = await import('@main/core/artifact-pages/page-source-elements');
const parse5 = await loadParse5();
const { artifactPagesController } = await import('@main/core/artifact-pages/controller');
const { artifactsController } = await import('./controller');

const WORK_ITEM_ID = 'w-entry';
const PAGE_ID = 'a-entry-page';
const DOCUMENT_ID = 'a-entry-doc';
const TOKENS_MARKER = '/*TOKENS_MARKER*/';

let root: string;
let repoDir: string;
let pagePath: string;

interface UploadPayload {
  artifact_id: string;
  work_item_id: string;
  client_version_id: string;
  trigger: string;
  label: string | null;
  content?: string;
  view_html?: string;
}

function uploadRows() {
  return db
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.entityType, 'artifact_version_upload'))
    .all()
    .map((row) => ({ ...row, body: JSON.parse(row.payload) as UploadPayload }));
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });

  root = mkdtempSync(join(tmpdir(), 'chord-entry-'));
  repoDir = join(root, 'repo');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(join(repoDir, 'site'), { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), `${TOKENS_MARKER}:root{}`);
  writeFileSync(join(runtimeDir, 'chord-page.js'), '/*BRIDGE*/');
  writeFileSync(join(runtimeDir, 'components.css'), '/*COMPONENTS*/');
  writeFileSync(join(runtimeDir, 'runtime-standalone.js'), '/*RUNTIME*/');
  writeFileSync(join(runtimeDir, 'mermaid-standalone.js'), '/*MERMAID*/');
  configureArtifactRuntimeDir(runtimeDir);

  pagePath = join(repoDir, 'site', 'index.html');
  writeFileSync(join(repoDir, 'plan.md'), '# Plan');

  await db.insert(repos).values({ id: 'r-entry', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-entry',
    repoPath: repoDir,
    name: 'Entry points',
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
  writeFileSync(
    pagePath,
    stampChordIds(parse5, '<html><head></head><body><p>Hello team</p></body></html>').html
  );
});

describe('artifacts.saveVersion', () => {
  it('queues a page save with its content and view', async () => {
    const content = '<html><head></head><body><p>Saved by hand</p></body></html>';
    const result = await artifactsController.saveVersion({
      artifactId: PAGE_ID,
      content,
      trigger: 'manual',
      label: 'Before review',
      baseVersion: 0,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version.authorName).toBe('ada');

    const [upload, ...rest] = uploadRows();
    expect(rest).toEqual([]);
    expect(upload.body).toMatchObject({
      artifact_id: PAGE_ID,
      work_item_id: WORK_ITEM_ID,
      client_version_id: result.data.version.id,
      trigger: 'manual',
      label: 'Before review',
      content,
    });
    expect(upload.body.view_html).toContain('Saved by hand');
    expect(upload.body.view_html).toContain(TOKENS_MARKER);
  });

  it('queues a document save without content or view', async () => {
    const result = await artifactsController.saveVersion({
      artifactId: DOCUMENT_ID,
      content: '# Plan\n\nRevised.',
      trigger: 'manual',
      baseVersion: 0,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [upload] = uploadRows();
    expect(upload.body).toEqual({
      artifact_id: DOCUMENT_ID,
      work_item_id: WORK_ITEM_ID,
      client_version_id: result.data.version.id,
      trigger: 'manual',
      label: null,
    });
  });

  it('reports a page whose view does not build as a typed error and saves nothing', async () => {
    const result = await artifactsController.saveVersion({
      artifactId: PAGE_ID,
      content: '<html><head></head><body><img src="nowhere.png"></body></html>',
      trigger: 'manual',
      baseVersion: 0,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'view_build_failed' });
    expect((result.error as { message: string }).message).toMatch(/nowhere\.png/);
    expect(db.select().from(artifactVersions).all()).toEqual([]);
    expect(uploadRows()).toEqual([]);
  });
});

describe('artifactPages.commitTextEdit', () => {
  it('queues the edited page with its view', async () => {
    const stamped = /<p data-chord-id="([^"]+)"/.exec(readFileSync(pagePath, 'utf-8'));
    expect(stamped).not.toBeNull();
    const id = stamped![1];

    const result = await artifactPagesController.commitTextEdit({
      artifactId: PAGE_ID,
      chordId: id,
      originalText: 'Hello team',
      text: 'Hello everyone',
    });
    expect(result.success).toBe(true);

    const [upload, ...rest] = uploadRows();
    expect(rest).toEqual([]);
    expect(upload.body).toMatchObject({
      artifact_id: PAGE_ID,
      trigger: 'manual',
      label: 'Edited in place',
    });
    expect(upload.body.content).toContain('Hello everyone');
    expect(upload.body.view_html).toContain('Hello everyone');
  });
});

describe('artifacts.create ("Add to artifacts")', () => {
  function queueRows() {
    return db.select().from(syncQueue).orderBy(asc(syncQueue.id)).all();
  }

  function versionsOf(artifactId: string) {
    return db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .all();
  }

  it('saves a new page as version 1, an agent milestone, and queues it with its view after the create', async () => {
    const filePath = join(repoDir, 'site', 'added.html');
    writeFileSync(
      filePath,
      '<html><head><link rel="stylesheet" href="added.css"></head><body><h1>Added by hand</h1></body></html>'
    );
    writeFileSync(join(repoDir, 'site', 'added.css'), 'h1{color:teal}');

    const result = await artifactsController.create({
      workItemId: WORK_ITEM_ID,
      filePath,
      name: 'added.html',
      type: 'web',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifactId = result.data.artifact!.id;

    const [version, ...more] = versionsOf(artifactId);
    expect(more).toEqual([]);
    expect(version).toMatchObject({
      versionNumber: 1,
      trigger: 'agent_milestone',
      authorName: 'ada',
    });
    // The file as added — after the chord ids were stamped.
    expect(version.content).toBe(readFileSync(filePath, 'utf-8'));
    expect(version.content).toContain('data-chord-id=');

    const rows = queueRows();
    const create = rows.findIndex(
      (row) => row.entityType === 'artifact' && row.entityId === artifactId
    );
    const uploads = uploadRows();
    expect(uploads).toHaveLength(1);
    const upload = rows.findIndex((row) => row.id === uploads[0].id);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(create);
    expect(uploads[0].body).toMatchObject({
      artifact_id: artifactId,
      work_item_id: WORK_ITEM_ID,
      client_version_id: version.id,
      trigger: 'agent_milestone',
      content: version.content,
    });
    expect(uploads[0].body.view_html).toContain('Added by hand');
    expect(uploads[0].body.view_html).toContain('h1{color:teal}');
    expect(uploads[0].body.view_html).toContain(TOKENS_MARKER);
  });

  it('republishing rebinds a duplicated id to the element the previous version had it on', async () => {
    const publish = () =>
      artifactsController.create({
        workItemId: WORK_ITEM_ID,
        filePath: pagePath,
        name: 'index.html',
        type: 'web',
      });
    expect((await publish()).success).toBe(true);
    const published = readFileSync(pagePath, 'utf-8');
    const id = /<p data-chord-id="([a-z0-9]+)">Hello team/.exec(published)![1];
    // The agent copies the paragraph and inserts the copy ABOVE the original.
    writeFileSync(pagePath, published.replace('<p', `<p data-chord-id="${id}">Copy</p><p`));

    expect((await publish()).success).toBe(true);
    const republished = readFileSync(pagePath, 'utf-8');
    expect(republished).toContain(`<p data-chord-id="${id}">Hello team</p>`);
    expect(republished).not.toContain(`<p data-chord-id="${id}">Copy</p>`);
    expect(versionsOf(PAGE_ID).map((v) => v.versionNumber)).toEqual([1, 2]);
  });

  it('saves a new document as version 1 locally and queues no upload, as publish does', async () => {
    const filePath = join(repoDir, 'notes.md');
    writeFileSync(filePath, '# Notes\n\nAdded by hand.');
    const result = await artifactsController.create({
      workItemId: WORK_ITEM_ID,
      filePath,
      name: 'notes.md',
      type: 'markdown',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifactId = result.data.artifact!.id;

    const [version] = versionsOf(artifactId);
    expect(version).toMatchObject({
      versionNumber: 1,
      trigger: 'agent_milestone',
      content: '# Notes\n\nAdded by hand.',
    });
    expect(uploadRows()).toEqual([]);
  });

  it('refuses a page whose view does not build, as a typed error, and adds nothing', async () => {
    const filePath = join(repoDir, 'site', 'added-broken.html');
    writeFileSync(filePath, '<html><head></head><body><img src="absent.png"></body></html>');
    const result = await artifactsController.create({
      workItemId: WORK_ITEM_ID,
      filePath,
      name: 'added-broken.html',
      type: 'web',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'view_build_failed' });
    expect((result.error as { message: string }).message).toMatch(/absent\.png/);
    expect(db.select().from(artifacts).where(eq(artifacts.filePath, filePath)).all()).toEqual([]);
    expect(queueRows()).toEqual([]);
  });
});
