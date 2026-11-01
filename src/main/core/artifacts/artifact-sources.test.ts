import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Drift (plan 2026-09-23 §4 P4 step 2, §7 "hash mismatch detection against a
 * real temp repo"): real SQLite from the shipped migrations, a real git
 * checkout on disk, and the publish tool as the agent calls it.
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
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { artifactSources } = await import('@main/db/schema-artifact-sources');
const { appSettingsService } = await import('@main/core/settings/settings-service');
const { publishArtifact } = await import('@main/core/agent-artifact-tools/publish-artifact');
const { listChangedSources, listWorkItemSourceDrift, rebaselineArtifactSources } = await import(
  './artifact-sources'
);

const WORK_ITEM_ID = 'w-drift';

let root: string;
let repoDir: string;

function context() {
  return { sessionId: 's-drift', workItemId: WORK_ITEM_ID, cwd: repoDir };
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' });
}

function commitAll(message: string): void {
  git('add', '-A');
  git(
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    message
  );
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  root = mkdtempSync(join(tmpdir(), 'chord-drift-'));
  repoDir = join(root, 'repo');
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  git('init', '--quiet');
  await db.insert(repos).values({ id: 'r-drift', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-drift',
    repoPath: repoDir,
    name: 'Drift',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(async () => {
  db.delete(artifacts).run();
  await appSettingsService.reset('artifacts');
  writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const TOKEN_TTL = 60;\n');
  writeFileSync(join(repoDir, 'src', 'session.ts'), 'export const IDLE = 5;\n');
  writeFileSync(join(repoDir, 'design.md'), '# Auth design\n\nTokens live 60 seconds.\n');
  commitAll('base');
});

async function publishDesign(sources?: string[]) {
  return publishArtifact(context(), { path: 'design.md', sources });
}

describe('publish_artifact sources', () => {
  it('stores one content hash per listed source, as absolute paths', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts', 'src/session.ts']);
    const rows = db.select().from(artifactSources).all();
    expect(rows.map((r) => r.path).sort()).toEqual(
      [join(repoDir, 'src', 'auth.ts'), join(repoDir, 'src', 'session.ts')].sort()
    );
    expect(
      rows.every((r) => r.artifactId === artifact_id && /^[0-9a-f]{64}$/.test(r.contentHash))
    ).toBe(true);
    expect(listChangedSources(artifact_id)).toEqual([]);
  });

  it('rejects a source outside the workspace, a missing source, and the artifact itself', async () => {
    const outside = join(root, 'outside.ts');
    writeFileSync(outside, 'x');
    await expect(publishDesign([outside])).rejects.toThrow(/outside the session workspace/);
    await expect(publishDesign(['src/missing.ts'])).rejects.toThrow(/does not exist/);
    await expect(publishDesign(['design.md'])).rejects.toThrow(/cannot be its own source/);
    // A rejected publish writes nothing: no artifact row, no source rows.
    expect(db.select().from(artifacts).all()).toHaveLength(0);
    expect(db.select().from(artifactSources).all()).toHaveLength(0);
  });
});

describe('source drift', () => {
  it('reports a committed edit to a listed source as modified, and nothing else', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts', 'src/session.ts']);
    writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const TOKEN_TTL = 3600;\n');
    commitAll('longer tokens');

    expect(listChangedSources(artifact_id)).toEqual([
      { path: join(repoDir, 'src', 'auth.ts'), change: 'modified' },
    ]);
    expect(listWorkItemSourceDrift(WORK_ITEM_ID)).toEqual([
      {
        artifactId: artifact_id,
        filePath: join(repoDir, 'design.md'),
        changed: [{ path: join(repoDir, 'src', 'auth.ts'), change: 'modified' }],
      },
    ]);
  });

  it('is not fooled by a rewrite with identical bytes', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts']);
    writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const TOKEN_TTL = 60;\n');
    expect(listChangedSources(artifact_id)).toEqual([]);
  });

  it('reports a deleted source as deleted', async () => {
    const { artifact_id } = await publishDesign(['src/session.ts']);
    unlinkSync(join(repoDir, 'src', 'session.ts'));
    expect(listChangedSources(artifact_id)).toEqual([
      { path: join(repoDir, 'src', 'session.ts'), change: 'deleted' },
    ]);
  });

  it('mark reviewed advances the baseline without republishing, and drops deleted sources', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts', 'src/session.ts']);
    writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const TOKEN_TTL = 1;\n');
    unlinkSync(join(repoDir, 'src', 'session.ts'));
    expect(listChangedSources(artifact_id)).toHaveLength(2);

    rebaselineArtifactSources(artifact_id);
    expect(listChangedSources(artifact_id)).toEqual([]);
    expect(
      db
        .select()
        .from(artifactSources)
        .all()
        .map((r) => r.path)
    ).toEqual([join(repoDir, 'src', 'auth.ts')]);
    expect(listWorkItemSourceDrift(WORK_ITEM_ID)).toEqual([]);
  });

  it('republishing without sources keeps the list and advances its baseline', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts']);
    writeFileSync(join(repoDir, 'src', 'auth.ts'), 'export const TOKEN_TTL = 2;\n');
    expect(listChangedSources(artifact_id)).toHaveLength(1);

    await publishDesign();
    expect(listChangedSources(artifact_id)).toEqual([]);
    expect(db.select().from(artifactSources).all()).toHaveLength(1);
  });

  it('republishing with sources replaces the list', async () => {
    const { artifact_id } = await publishDesign(['src/auth.ts']);
    await publishDesign(['src/session.ts']);
    expect(
      db
        .select()
        .from(artifactSources)
        .all()
        .map((r) => r.path)
    ).toEqual([join(repoDir, 'src', 'session.ts')]);
    await publishDesign([]);
    expect(listChangedSources(artifact_id)).toEqual([]);
    expect(db.select().from(artifactSources).all()).toHaveLength(0);
  });
});
