import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * The author's own view of a binary artifact (design 2026-09-24 §10 "Desktop"):
 * the local file — or a saved version's bytes — served over `chord-artifact://`
 * with the frame isolation headers. A pdf is its bytes, an image or docx its
 * view, a pptx a card with no frame at all. Real SQLite, real files, the real
 * protocol handler.
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
const { artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { configureArtifactRuntimeDir } = await import(
  '@main/core/artifact-pages/artifact-runtime-dir'
);
const { handleArtifactPageRequest } = await import('@main/core/artifact-pages/serve-page-request');
const { publishArtifact } = await import('@main/core/agent-artifact-tools/publish-artifact');
const { prepareLocalArtifactFile } = await import('./prepare-local-artifact-file');

const WORK_ITEM_ID = 'w-local-files';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 8]);

let root: string;
let repoDir: string;
let runtimeDir: string;

function context() {
  return { sessionId: 's-local-files', workItemId: WORK_ITEM_ID, cwd: repoDir };
}

function serve(url: string): Promise<Response> {
  return handleArtifactPageRequest(new Request(url), runtimeDir);
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  root = mkdtempSync(join(tmpdir(), 'chord-local-files-'));
  repoDir = join(root, 'repo');
  runtimeDir = join(root, 'runtime');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), ':root{}');
  writeFileSync(join(runtimeDir, 'chord-page.js'), '/*BRIDGE*/');
  writeFileSync(join(runtimeDir, 'docx-viewer-standalone.js'), '/*DOCX*/');
  configureArtifactRuntimeDir(runtimeDir);

  await db.insert(repos).values({ id: 'r-local-files', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-local-files',
    repoPath: repoDir,
    name: 'Local files',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(() => {
  db.delete(artifacts).run();
  db.delete(syncQueue).run();
  writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4 v1');
  writeFileSync(join(repoDir, 'chart.png'), PNG_BYTES);
  writeFileSync(join(repoDir, 'deck.pptx'), 'PK deck');
});

describe('prepareLocalArtifactFile', () => {
  it('serves a pdf as its own bytes under the frame isolation headers', async () => {
    const { artifact_id } = await publishArtifact(context(), { path: 'brief.pdf' });
    const prepared = await prepareLocalArtifactFile({ artifactId: artifact_id });
    expect(prepared).toMatchObject({
      viewer: 'pdf',
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      byteSize: 11,
      versionNumber: null,
    });
    expect(prepared.url).toMatch(/^chord-artifact:\/\/[a-z0-9-]+\/$/);

    const res = await serve(prepared.url!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.4 v1');
    expect((await serve(`${prepared.url!}other.js`)).status).toBe(404);
  });

  it('serves an image through its view', async () => {
    const { artifact_id } = await publishArtifact(context(), { path: 'chart.png' });
    const prepared = await prepareLocalArtifactFile({ artifactId: artifact_id });
    expect(prepared.viewer).toBe('view');
    const res = await serve(prepared.url!);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain(`data:image/png;base64,${PNG_BYTES.toString('base64')}`);
  });

  it('gives a pptx a card and no frame', async () => {
    const { artifact_id } = await publishArtifact(context(), { path: 'deck.pptx' });
    expect(await prepareLocalArtifactFile({ artifactId: artifact_id })).toEqual({
      viewer: 'card',
      url: null,
      fileName: 'deck.pptx',
      mimeType: PPTX,
      byteSize: 7,
      versionId: null,
      versionNumber: null,
    });
  });

  it('shows the file on disk now, and a saved version as it was saved', async () => {
    const first = await publishArtifact(context(), { path: 'brief.pdf' });
    writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4 v2 unpublished');

    const current = await prepareLocalArtifactFile({ artifactId: first.artifact_id });
    expect(Buffer.from(await (await serve(current.url!)).arrayBuffer()).toString()).toBe(
      '%PDF-1.4 v2 unpublished'
    );

    const { artifactVersions } = await import('@main/db/schema-artifacts');
    const [v1] = db.select().from(artifactVersions).all();
    const saved = await prepareLocalArtifactFile({
      artifactId: first.artifact_id,
      versionId: v1!.id,
    });
    expect(saved).toMatchObject({ versionId: v1!.id, versionNumber: 1, byteSize: 11 });
    expect(Buffer.from(await (await serve(saved.url!)).arrayBuffer()).toString()).toBe(
      '%PDF-1.4 v1'
    );
  });

  it('refuses an artifact that is not a file', async () => {
    writeFileSync(join(repoDir, 'plan.md'), '# Plan');
    const { artifact_id } = await publishArtifact(context(), { path: 'plan.md' });
    await expect(prepareLocalArtifactFile({ artifactId: artifact_id })).rejects.toThrow(
      /not a file/
    );
  });
});
