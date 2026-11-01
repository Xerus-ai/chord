import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Real SQLite from the shipped migrations (the repo's standard substitution,
 * see serve-page-request.test.ts): publishing reads and writes the same
 * `artifacts` rows and `app_settings` row production does. Publishing saves a
 * version attributed to the signed-in user, so the suite signs in through the
 * real account path (`_testing/test-account.ts`).
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
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { appSettingsService } = await import('@main/core/settings/settings-service');
const { publishArtifact, listPublishedArtifacts } = await import('./publish-artifact');
const { buildChordTools } = await import('./chord-mcp-server');
const { registerArtifactToolSession } = await import('./artifact-tool-sessions');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { configureArtifactRuntimeDir } = await import(
  '@main/core/artifact-pages/artifact-runtime-dir'
);

const WORK_ITEM_ID = 'w-publish';

let root: string;
let repoDir: string;
let outsideFile: string;

function context() {
  return { sessionId: 's-publish', workItemId: WORK_ITEM_ID, cwd: repoDir };
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  root = mkdtempSync(join(tmpdir(), 'chord-publish-'));
  repoDir = join(root, 'repo');
  mkdirSync(join(repoDir, 'docs'), { recursive: true });
  // Publishing a page builds its view from the page runtime.
  const runtimeDir = join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  for (const name of [
    'tokens.css',
    'chord-page.js',
    'components.css',
    'runtime-standalone.js',
    'mermaid-standalone.js',
  ]) {
    writeFileSync(join(runtimeDir, name), `/* ${name} */`);
  }
  configureArtifactRuntimeDir(runtimeDir);
  writeFileSync(join(repoDir, 'plan.md'), '# Plan\n\nShip it.');
  writeFileSync(join(repoDir, 'docs', 'report.html'), '<!doctype html><title>Report</title>');
  writeFileSync(join(repoDir, 'brief.pdf'), '%PDF-1.4');
  writeFileSync(join(repoDir, 'Demo.tsx'), 'export default function Demo() { return null; }');
  outsideFile = join(root, 'outside.md');
  writeFileSync(outsideFile, '# Not in the workspace');

  await db.insert(repos).values({ id: 'r-publish', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-publish',
    repoPath: repoDir,
    name: 'Publishing',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(async () => {
  db.delete(artifacts).run();
  await appSettingsService.reset('artifacts');
});

describe('publishArtifact — path-based upsert', () => {
  it('creates the artifact on first publish and updates the same row on the second', async () => {
    const first = await publishArtifact(context(), { path: 'plan.md' });
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(repoDir, 'plan.md'));
    expect(first.format).toBe('markdown');

    const second = await publishArtifact(context(), { path: 'plan.md', title: 'Launch plan' });
    expect(second.created).toBe(false);
    expect(second.artifact_id).toBe(first.artifact_id);

    const rows = db.select().from(artifacts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Launch plan');
  });

  it('treats an absolute path and a relative path to the same file as one artifact', async () => {
    const first = await publishArtifact(context(), { path: join(repoDir, 'docs', 'report.html') });
    const second = await publishArtifact(context(), { path: 'docs/report.html' });
    expect(second.created).toBe(false);
    expect(second.artifact_id).toBe(first.artifact_id);
    expect(second.format).toBe('web');
  });

  it('publishes a view-only type with no format given', async () => {
    const result = await publishArtifact(context(), { path: 'brief.pdf' });
    expect(result.created).toBe(true);
    expect(result.format).toBe('document');
  });

  it('sends the render class the server derives when it registers the artifact', async () => {
    await publishArtifact(context(), { path: 'Demo.tsx', format: 'prototype' });
    const [row] = db.select().from(artifacts).all();
    expect(row.contentType).toBe('prototype');
  });
});

describe('publishArtifact — rejections', () => {
  it('rejects a relative path that climbs out of the session cwd', async () => {
    await expect(publishArtifact(context(), { path: '../outside.md' })).rejects.toThrow(
      /outside the session workspace/
    );
    expect(db.select().from(artifacts).all()).toHaveLength(0);
  });

  it('rejects an absolute path outside the session cwd', async () => {
    await expect(publishArtifact(context(), { path: outsideFile })).rejects.toThrow(
      /outside the session workspace/
    );
  });

  it('rejects agent machinery inside the workspace', async () => {
    mkdirSync(join(repoDir, '.claude'), { recursive: true });
    writeFileSync(join(repoDir, '.claude', 'draft.md'), '# draft');
    await expect(publishArtifact(context(), { path: '.claude/draft.md' })).rejects.toThrow(
      /outside the session workspace/
    );
  });

  it('rejects a file that does not exist', async () => {
    await expect(publishArtifact(context(), { path: 'missing.md' })).rejects.toThrow(
      /does not exist/
    );
  });

  it('rejects a format that contradicts the extension instead of coercing it', async () => {
    await expect(publishArtifact(context(), { path: 'plan.md', format: 'web' })).rejects.toThrow(
      /contradicts/
    );
    expect(db.select().from(artifacts).all()).toHaveLength(0);
  });

  it('rejects publishing while "Let agents create artifacts" is off', async () => {
    const current = await appSettingsService.get('artifacts');
    await appSettingsService.update('artifacts', { ...current, enabled: false });
    await expect(publishArtifact(context(), { path: 'plan.md' })).rejects.toThrow(/turned off/);
    expect(db.select().from(artifacts).all()).toHaveLength(0);
  });
});

describe('listPublishedArtifacts', () => {
  it('lists the work item artifacts with their format and status', async () => {
    const published = await publishArtifact(context(), { path: 'plan.md' });
    const listed = await listPublishedArtifacts(context());
    expect(listed).toEqual([
      {
        artifact_id: published.artifact_id,
        path: join(repoDir, 'plan.md'),
        title: 'plan.md',
        format: 'markdown',
        status: 'draft',
      },
    ]);
  });
});

describe('chord MCP tools', () => {
  it('resolves the work item from the session token, never from an argument', async () => {
    const published: string[] = [];
    const session = registerArtifactToolSession({
      ...context(),
      preferredFormat: 'best-fit',
      onPublished: (result) => published.push(result.path),
    });
    const publish = buildChordTools(session.token, 'best-fit').find(
      (t) => t.name === 'publish_artifact'
    );
    expect(publish).toBeDefined();
    expect(Object.keys(publish!.inputSchema)).not.toContain('work_item_id');

    const result = await publish!.handler({ path: 'plan.md' }, {});
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      created: true,
      format: 'markdown',
    });
    expect(published).toEqual([join(repoDir, 'plan.md')]);
    session.dispose();
  });

  it('reports a rejected publish as a tool error the agent can read', async () => {
    const session = registerArtifactToolSession({
      ...context(),
      preferredFormat: 'best-fit',
      onPublished: () => undefined,
    });
    const publish = buildChordTools(session.token, 'best-fit').find(
      (t) => t.name === 'publish_artifact'
    )!;
    const result = await publish.handler({ path: '../outside.md' }, {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/outside the session workspace/);
    session.dispose();
  });

  it('refuses a token whose session has ended', async () => {
    const session = registerArtifactToolSession({
      ...context(),
      preferredFormat: 'best-fit',
      onPublished: () => undefined,
    });
    const publish = buildChordTools(session.token, 'best-fit').find(
      (t) => t.name === 'publish_artifact'
    )!;
    session.dispose();
    const result = await publish.handler({ path: 'plan.md' }, {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/session has ended/);
  });

  it('names the preferred format in the tool description, and omits it for best fit', () => {
    const descriptionFor = (preference: 'best-fit' | 'mdx') =>
      buildChordTools('unused', preference).find((t) => t.name === 'publish_artifact')!.description;
    expect(descriptionFor('mdx')).toMatch(/prefers Rich document \(\.mdx\)/);
    expect(descriptionFor('best-fit')).not.toMatch(/prefers/);
  });
});
