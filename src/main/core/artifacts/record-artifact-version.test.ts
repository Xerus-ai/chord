import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Every local version of a page is uploaded with its self-contained view
 * (design 2026-09-24 §9 "Upload"). A document's manual save is uploaded
 * without one — it is made from an open editor, so the server snapshots its
 * live Yjs state. A document's agent milestone is kept local only: the live
 * document holds the agent's content only once the author's editor applies it
 * (use-agent-content-push.ts), so a snapshot at publish time would record the
 * old text under the milestone. The upload is durable: a `sync_queue` row,
 * drained later. Real SQLite from the shipped migrations, real files, real
 * bundlers.
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
const { recordArtifactVersion } = await import('./record-artifact-version');

const WORK_ITEM_ID = 'w-record';
const PAGE_ID = 'a-record-page';
const PROTOTYPE_ID = 'a-record-proto';
const DOCUMENT_ID = 'a-record-doc';

const TOKENS_MARKER = '/*TOKENS_MARKER*/';
const RUNTIME_MARKER = '/*RUNTIME_MARKER*/';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5, 6, 7, 8]);

let root: string;
let repoDir: string;

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

function versionRows(artifactId: string) {
  return db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .all();
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'chord-record-'));
  repoDir = join(root, 'repo');
  const runtimeDir = join(root, 'runtime');
  mkdirSync(join(repoDir, 'site'), { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'tokens.css'), `${TOKENS_MARKER}:root{}`);
  writeFileSync(join(runtimeDir, 'chord-page.js'), '/*BRIDGE*/');
  writeFileSync(join(runtimeDir, 'components.css'), '/*COMPONENTS*/');
  writeFileSync(join(runtimeDir, 'runtime-standalone.js'), `${RUNTIME_MARKER}window.React={};`);
  writeFileSync(join(runtimeDir, 'mermaid-standalone.js'), '/*MERMAID*/');
  configureArtifactRuntimeDir(runtimeDir);

  writeFileSync(
    join(repoDir, 'site', 'index.html'),
    '<html><head></head><body><p>on disk</p></body></html>'
  );
  writeFileSync(join(repoDir, 'site', 'logo.png'), PNG_BYTES);
  writeFileSync(
    join(repoDir, 'Widget.tsx'),
    'export default function Widget() { return <b>widget body</b>; }'
  );
  writeFileSync(join(repoDir, 'plan.md'), '# Plan');

  await db.insert(repos).values({ id: 'r-record', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-record',
    repoPath: repoDir,
    name: 'Recording',
  });
  await db.insert(artifacts).values([
    {
      id: PAGE_ID,
      workItemId: WORK_ITEM_ID,
      filePath: join(repoDir, 'site', 'index.html'),
      name: 'index.html',
      type: 'web',
      contentType: 'web',
    },
    {
      id: PROTOTYPE_ID,
      workItemId: WORK_ITEM_ID,
      filePath: join(repoDir, 'Widget.tsx'),
      name: 'Widget.tsx',
      type: 'prototype',
      contentType: 'prototype',
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
});

describe('recordArtifactVersion — pages', () => {
  it('saves the version and queues its upload with the content and a view built from it', async () => {
    const content =
      '<html><head></head><body><p>saved version text</p><img src="logo.png"></body></html>';
    const result = await recordArtifactVersion({
      artifactId: PAGE_ID,
      content,
      trigger: 'manual',
      label: 'Checkpoint',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.version.versionNumber).toBe(1);
    expect(result.warnings).toEqual([]);

    const [upload, ...rest] = uploadRows();
    expect(rest).toEqual([]);
    expect(upload.operation).toBe('create');
    expect(upload.entityId).toBe(result.version.id);
    expect(upload.body).toMatchObject({
      artifact_id: PAGE_ID,
      work_item_id: WORK_ITEM_ID,
      client_version_id: result.version.id,
      trigger: 'manual',
      label: 'Checkpoint',
      content,
    });
    // The view is the stored version, not whatever is on disk now.
    expect(upload.body.view_html).toContain('saved version text');
    expect(upload.body.view_html).not.toContain('on disk');
    expect(upload.body.view_html).toContain(TOKENS_MARKER);
    expect(upload.body.view_html).toContain(
      `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    );
  });

  it('returns the view’s remote-reference warnings', async () => {
    const result = await recordArtifactVersion({
      artifactId: PAGE_ID,
      content: '<html><head></head><body><img src="https://img.example.com/a.png"></body></html>',
      trigger: 'manual',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.warnings.some((w) => w.includes('https://img.example.com/a.png'))).toBe(true);
  });

  it('builds a prototype version’s view from the runtime and its bundle', async () => {
    const result = await recordArtifactVersion({
      artifactId: PROTOTYPE_ID,
      content: 'export default function Widget() { return <b>saved widget</b>; }',
      trigger: 'agent_milestone',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    const [upload] = uploadRows();
    expect(upload.body.trigger).toBe('agent_milestone');
    expect(upload.body.view_html).toContain(RUNTIME_MARKER);
    expect(upload.body.view_html).toContain('saved widget');
  });

  it('fails loudly when the view cannot be built, and stores nothing', async () => {
    await expect(
      recordArtifactVersion({
        artifactId: PAGE_ID,
        content: '<html><head></head><body><img src="gone.png"></body></html>',
        trigger: 'manual',
        authorName: 'ada@example.com',
        baseVersion: 0,
      })
    ).rejects.toThrow(/gone\.png/);
    expect(versionRows(PAGE_ID)).toEqual([]);
    expect(uploadRows()).toEqual([]);
  });

  it('queues nothing for a save refused as a conflict', async () => {
    await recordArtifactVersion({
      artifactId: PAGE_ID,
      content: '<p>one</p>',
      trigger: 'manual',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    const conflict = await recordArtifactVersion({
      artifactId: PAGE_ID,
      content: '<p>stale</p>',
      trigger: 'manual',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(conflict).toEqual({ status: 'conflict', latestVersion: 1 });
    expect(uploadRows()).toHaveLength(1);
  });
});

describe('recordArtifactVersion — documents', () => {
  it('queues a manual save without content or view', async () => {
    const result = await recordArtifactVersion({
      artifactId: DOCUMENT_ID,
      content: '# Plan\n\nRevised.',
      trigger: 'manual',
      label: 'Revised',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;

    const [upload, ...rest] = uploadRows();
    expect(rest).toEqual([]);
    expect(upload.entityId).toBe(result.version.id);
    expect(upload.body).toEqual({
      artifact_id: DOCUMENT_ID,
      work_item_id: WORK_ITEM_ID,
      client_version_id: result.version.id,
      trigger: 'manual',
      label: 'Revised',
    });
  });

  it('saves an agent milestone locally and queues no upload', async () => {
    const result = await recordArtifactVersion({
      artifactId: DOCUMENT_ID,
      content: '# Plan\n\nThe agent revised it.',
      trigger: 'agent_milestone',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.version).toMatchObject({
      trigger: 'agent_milestone',
      content: '# Plan\n\nThe agent revised it.',
    });
    expect(uploadRows()).toEqual([]);
  });

  it('queues nothing for an automatic snapshot (the server keeps its own)', async () => {
    const result = await recordArtifactVersion({
      artifactId: DOCUMENT_ID,
      content: '# Plan\n\nAutosaved.',
      trigger: 'auto',
      authorName: 'ada@example.com',
      baseVersion: 0,
    });
    expect(result.status).toBe('saved');
    expect(uploadRows()).toEqual([]);
  });
});
