import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Publishing a binary file (design 2026-09-24 §10 decisions 2–4): the version is
 * the file's bytes, saved locally as base64 and queued for upload with its MIME
 * type — plus a view for images and docx — so a teammate can open it with the
 * author's machine off. A file over 8 MiB fails the publish and leaves nothing
 * behind. Real SQLite, real files; the signed-in account goes through the real
 * account path (see `_testing/test-account.ts`).
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
const { publishArtifact } = await import('./publish-artifact');

const WORK_ITEM_ID = 'w-files';
const DOCX_VIEWER_MARKER = '/*DOCX_VIEWER_MARKER*/';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7]);

let root: string;
let repoDir: string;

function context() {
  return { sessionId: 's-files', workItemId: WORK_ITEM_ID, cwd: repoDir };
}

interface UploadPayload {
  client_version_id: string;
  trigger: string;
  content?: string;
  view_html?: string;
  file_base64?: string;
  mime_type?: string;
}

function uploadRows() {
  return db
    .select()
    .from(syncQueue)
    .orderBy(asc(syncQueue.id))
    .all()
    .filter((row) => row.entityType === 'artifact_version_upload')
    .map((row) => JSON.parse(row.payload) as UploadPayload);
}

function versionsOf(artifactId: string) {
  return db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(asc(artifactVersions.versionNumber))
    .all();
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });

  root = mkdtempSync(join(tmpdir(), 'chord-files-'));
  repoDir = join(root, 'repo');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), ':root{}');
  writeFileSync(join(runtimeDir, 'chord-page.js'), '/*BRIDGE*/');
  writeFileSync(join(runtimeDir, 'docx-viewer-standalone.js'), DOCX_VIEWER_MARKER);
  configureArtifactRuntimeDir(runtimeDir);

  await db.insert(repos).values({ id: 'r-files', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-files',
    repoPath: repoDir,
    name: 'Files',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(() => {
  db.delete(artifacts).run();
  db.delete(syncQueue).run();
  writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4 brief v1');
  writeFileSync(join(repoDir, 'chart.png'), PNG_BYTES);
  writeFileSync(join(repoDir, 'memo.docx'), 'PK memo');
  writeFileSync(join(repoDir, 'deck.pptx'), 'PK deck');
});

describe('publishArtifact — binary files', () => {
  it('saves a pdf as version 1 of its bytes and queues the upload without a view', async () => {
    const result = await publishArtifact(context(), { path: 'brief.pdf' });
    expect(result.version_number).toBe(1);

    const [version, ...more] = versionsOf(result.artifact_id);
    expect(more).toEqual([]);
    const bytes = Buffer.from('%PDF-1.4 brief v1').toString('base64');
    expect(version).toMatchObject({
      trigger: 'agent_milestone',
      authorName: 'ada',
      content: bytes,
    });

    const [upload, ...others] = uploadRows();
    expect(others).toEqual([]);
    expect(upload).toEqual({
      artifact_id: result.artifact_id,
      work_item_id: WORK_ITEM_ID,
      client_version_id: version.id,
      trigger: 'agent_milestone',
      label: null,
      file_base64: bytes,
      mime_type: 'application/pdf',
    });
  });

  it('uploads an image and a docx with their view', async () => {
    const image = await publishArtifact(context(), { path: 'chart.png' });
    const docx = await publishArtifact(context(), { path: 'memo.docx' });
    expect(image.version_number).toBe(1);
    expect(docx.version_number).toBe(1);

    const [imageUpload, docxUpload] = uploadRows();
    expect(imageUpload.mime_type).toBe('image/png');
    expect(imageUpload.view_html).toContain(
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    );
    expect(docxUpload.mime_type).toBe(DOCX);
    expect(docxUpload.view_html).toContain(DOCX_VIEWER_MARKER);
    expect(docxUpload.view_html).toContain(Buffer.from('PK memo').toString('base64'));
  });

  it('uploads a pptx as its bytes only', async () => {
    await publishArtifact(context(), { path: 'deck.pptx' });
    const [upload] = uploadRows();
    expect(upload.mime_type).toBe(PPTX);
    expect(upload.file_base64).toBe(Buffer.from('PK deck').toString('base64'));
    expect(upload).not.toHaveProperty('view_html');
  });

  it('saves the rewritten bytes as the next version on republish', async () => {
    const first = await publishArtifact(context(), { path: 'brief.pdf' });
    writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4 brief v2');
    const second = await publishArtifact(context(), { path: 'brief.pdf' });
    expect(second.artifact_id).toBe(first.artifact_id);
    expect(second.version_number).toBe(2);
    const uploads = uploadRows();
    expect(uploads.map((u) => Buffer.from(u.file_base64!, 'base64').toString())).toEqual([
      '%PDF-1.4 brief v1',
      '%PDF-1.4 brief v2',
    ]);
  });

  it('fails a file over 8 MiB, naming the size, and leaves nothing behind', async () => {
    writeFileSync(join(repoDir, 'huge.pdf'), Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    await expect(publishArtifact(context(), { path: 'huge.pdf' })).rejects.toThrow(/8 MiB/);
    expect(db.select().from(artifacts).all()).toEqual([]);
    expect(db.select().from(artifactVersions).all()).toEqual([]);
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });
});
