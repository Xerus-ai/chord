import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Publishing is an agent milestone (design 2026-09-24 §9 decision 4, "Upload"):
 * a new artifact gets version 1 at once and a republish saves the next
 * version, each attributed to the signed-in user and queued for upload — a
 * page with its self-contained view, so a teammate can open it with the
 * author's machine off. A view that does not build fails the publish with the
 * compiler's message. Real SQLite, real files, real bundlers; the signed-in
 * account goes through the real account path (see `_testing/test-account.ts`).
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
const { appSettingsService } = await import('@main/core/settings/settings-service');
const { publishArtifact } = await import('./publish-artifact');
const { buildChordTools } = await import('./chord-mcp-server');
const { registerArtifactToolSession } = await import('./artifact-tool-sessions');

const WORK_ITEM_ID = 'w-milestone';
const TOKENS_MARKER = '/*TOKENS_MARKER*/';
const RUNTIME_MARKER = '/*RUNTIME_MARKER*/';

let root: string;
let repoDir: string;

function context() {
  return { sessionId: 's-milestone', workItemId: WORK_ITEM_ID, cwd: repoDir };
}

interface UploadPayload {
  artifact_id: string;
  work_item_id: string;
  client_version_id: string;
  trigger: string;
  label: string | null;
  content?: string;
  view_html?: string;
}

function queueRows() {
  return db.select().from(syncQueue).orderBy(asc(syncQueue.id)).all();
}

function uploadRows() {
  return queueRows()
    .filter((row) => row.entityType === 'artifact_version_upload')
    .map((row) => ({ ...row, body: JSON.parse(row.payload) as UploadPayload }));
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

  root = mkdtempSync(join(tmpdir(), 'chord-milestone-'));
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

  writeFileSync(join(repoDir, 'plan.md'), '# Plan\n\nShip it.');
  writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4');
  writeFileSync(join(repoDir, 'Broken.tsx'), 'export default function Broken() { return <div>; }');
  writeFileSync(
    join(repoDir, 'Widget.tsx'),
    'export default function Widget() { return <b>widget body</b>; }'
  );

  await db.insert(repos).values({ id: 'r-milestone', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-milestone',
    repoPath: repoDir,
    name: 'Milestones',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(async () => {
  db.delete(artifacts).run();
  db.delete(syncQueue).run();
  await appSettingsService.reset('artifacts');
  writeFileSync(
    join(repoDir, 'site', 'report.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body><h1>Report v1</h1></body></html>'
  );
  writeFileSync(join(repoDir, 'site', 'report.css'), 'h1{color:rebeccapurple}');
});

describe('publishArtifact — a new page', () => {
  it('saves version 1 as an agent milestone and queues its upload with the view', async () => {
    const result = await publishArtifact(context(), { path: 'site/report.html' });
    expect(result.created).toBe(true);
    expect(result.version_number).toBe(1);
    expect(result.warnings).toEqual([]);

    const [version, ...more] = versionsOf(result.artifact_id);
    expect(more).toEqual([]);
    expect(version).toMatchObject({
      versionNumber: 1,
      trigger: 'agent_milestone',
      authorName: 'ada',
    });
    // The version is the file as published — after the chord ids were stamped.
    expect(version.content).toBe(readFileSync(join(repoDir, 'site', 'report.html'), 'utf-8'));

    const [upload, ...others] = uploadRows();
    expect(others).toEqual([]);
    expect(upload.entityId).toBe(version.id);
    expect(upload.body).toMatchObject({
      artifact_id: result.artifact_id,
      work_item_id: WORK_ITEM_ID,
      client_version_id: version.id,
      trigger: 'agent_milestone',
      content: version.content,
    });
    expect(upload.body.view_html).toContain('Report v1');
    expect(upload.body.view_html).toContain('h1{color:rebeccapurple}');
    expect(upload.body.view_html).toContain(TOKENS_MARKER);
  });

  it('queues the upload after the artifact’s own create', async () => {
    const result = await publishArtifact(context(), { path: 'site/report.html' });
    const rows = queueRows();
    const create = rows.findIndex(
      (row) => row.entityType === 'artifact' && row.entityId === result.artifact_id
    );
    const upload = rows.findIndex((row) => row.entityType === 'artifact_version_upload');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(create);
  });

  it('builds a prototype’s view from the runtime and its bundle', async () => {
    const result = await publishArtifact(context(), { path: 'Widget.tsx' });
    expect(result.version_number).toBe(1);
    const [upload] = uploadRows();
    expect(upload.body.view_html).toContain(RUNTIME_MARKER);
    expect(upload.body.view_html).toContain('widget body');
  });
});

describe('publishArtifact — republishing', () => {
  it('saves the next version as an agent milestone and queues its upload', async () => {
    const first = await publishArtifact(context(), { path: 'site/report.html' });
    writeFileSync(
      join(repoDir, 'site', 'report.html'),
      '<!doctype html><html><head></head><body><h1>Report v2</h1></body></html>'
    );
    const second = await publishArtifact(context(), { path: 'site/report.html' });
    expect(second.created).toBe(false);
    expect(second.artifact_id).toBe(first.artifact_id);
    expect(second.version_number).toBe(2);

    const versions = versionsOf(first.artifact_id);
    expect(versions.map((v) => [v.versionNumber, v.trigger])).toEqual([
      [1, 'agent_milestone'],
      [2, 'agent_milestone'],
    ]);
    const uploads = uploadRows();
    expect(uploads.map((u) => u.body.client_version_id)).toEqual(versions.map((v) => v.id));
    expect(uploads[1].body.view_html).toContain('Report v2');
    expect(uploads[1].body.view_html).not.toContain('Report v1');
  });
});

describe('publishArtifact — documents and view-only files', () => {
  it('saves a document milestone locally and queues no upload', async () => {
    // The live document holds the agent's content only once the author's
    // editor applies it, so the cloud milestone is taken from there instead.
    const result = await publishArtifact(context(), { path: 'plan.md' });
    expect(result.version_number).toBe(1);
    const [version] = versionsOf(result.artifact_id);
    expect(version).toMatchObject({ trigger: 'agent_milestone', content: '# Plan\n\nShip it.' });
    expect(uploadRows()).toEqual([]);
    // The artifact itself is still registered with the cloud.
    expect(
      queueRows().some(
        (row) => row.entityType === 'artifact' && row.entityId === result.artifact_id
      )
    ).toBe(true);
  });
  // Binary files (pdf, docx, pptx, images): publish-artifact-files.test.ts.
});

describe('publishArtifact — the view must build', () => {
  it('fails a new publish with the compiler message and leaves nothing behind', async () => {
    await expect(publishArtifact(context(), { path: 'Broken.tsx' })).rejects.toThrow(/Broken\.tsx/);
    expect(db.select().from(artifacts).all()).toEqual([]);
    expect(db.select().from(artifactVersions).all()).toEqual([]);
    expect(queueRows()).toEqual([]);
  });

  it('fails a republish whose page lost a local asset, keeping the earlier version', async () => {
    const first = await publishArtifact(context(), { path: 'site/report.html' });
    rmSync(join(repoDir, 'site', 'report.css'));
    await expect(publishArtifact(context(), { path: 'site/report.html' })).rejects.toThrow(
      /report\.css/
    );
    expect(versionsOf(first.artifact_id)).toHaveLength(1);
    expect(uploadRows()).toHaveLength(1);
  });

  it('tells the agent about remote references the view cannot load', async () => {
    writeFileSync(
      join(repoDir, 'site', 'remote.html'),
      '<html><head><script src="https://cdn.example.com/chart.js"></script></head><body>x</body></html>'
    );
    const session = registerArtifactToolSession({
      ...context(),
      preferredFormat: 'best-fit',
      onPublished: () => undefined,
    });
    const publish = buildChordTools(session.token, 'best-fit').find(
      (tool) => tool.name === 'publish_artifact'
    )!;
    const result = await publish.handler({ path: 'site/remote.html' }, {});
    session.dispose();
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content[0] as { text: string }).text) as {
      warnings: string[];
    };
    expect(body.warnings.some((w) => w.includes('https://cdn.example.com/chart.js'))).toBe(true);
  });
});
