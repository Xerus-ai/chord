import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { resolveRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  buildExecutableBundle,
  collectChordScripts,
  selectCheckoutScripts,
} from './executable-bundle';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const REPO_ID = 'repo-1';

/**
 * Run and test scripts in the bundle the user approves (plan §"Decisions for
 * Phase 4", Trust): the bundle carries them exactly as the team file writes
 * them, so an approval given before named run scripts existed — of a string
 * `run` — keeps its hash. Real repository, resolved through the real resolver.
 */
describe('run and test scripts in the executable bundle', () => {
  let repoDir: string;

  async function commitTeamFile(config: object): Promise<void> {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), JSON.stringify(config));
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'team config'], repoDir);
  }

  async function bundleAtMain() {
    const config = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });
    return buildExecutableBundle(collectChordScripts(config), {});
  }

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-run-'));
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
  });

  afterEach(() => {
    db.delete(repos).run();
    removeDirSync(repoDir);
  });

  // Both hashes were computed by the code before Phase 4 (commit bda1b15)
  // from these same team files. A change here voids every existing approval.
  it('keeps the hash an approval of a string run was given for', async () => {
    await commitTeamFile({
      shellSetup: 'source .envrc',
      scripts: { setup: 'pnpm i', run: 'pnpm dev', teardown: 'make down' },
    });

    const bundle = await bundleAtMain();

    expect(bundle?.content.chord).toEqual({
      setup: 'pnpm i',
      run: 'pnpm dev',
      teardown: 'make down',
      shellSetup: 'source .envrc',
    });
    expect(bundle?.hash).toBe('57d7956192fc08685e41d74ed18a2c7b59a1d615269add5ea16bb82e83e462d9');
  });

  it('keeps the hash of a bundle that is only a string run', async () => {
    await commitTeamFile({ scripts: { run: 'pnpm dev' } });

    expect((await bundleAtMain())?.hash).toBe(
      '18230e1871c9311d05e7699378975a04f1c3a432eaebb201a5365b0900b514f5'
    );
  });

  it('carries named run scripts as an object, and the test script', async () => {
    await commitTeamFile({
      scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
    });

    expect((await bundleAtMain())?.content.chord).toEqual({
      run: { web: 'pnpm web', api: 'pnpm api' },
      test: 'pnpm test',
    });
  });

  it('trims named run commands and leaves out empty ones', async () => {
    await commitTeamFile({ scripts: { run: { web: '  pnpm web \n', api: '  ' } } });
    expect((await bundleAtMain())?.content.chord).toEqual({ run: { web: 'pnpm web' } });

    await commitTeamFile({ scripts: { run: { web: ' ' }, test: '' } });
    expect(await bundleAtMain()).toBeNull();
  });

  it('hashes a named script differently from the same command as the string run', async () => {
    await commitTeamFile({ scripts: { run: 'pnpm dev' } });
    const asString = await bundleAtMain();
    await commitTeamFile({ scripts: { run: { web: 'pnpm dev' } } });
    const asNamed = await bundleAtMain();

    expect(asNamed?.hash).not.toBe(asString?.hash);
  });

  it("leaves out the user's own run and test: they need no approval", async () => {
    await commitTeamFile({
      scripts: { setup: 'pnpm i', run: { web: 'pnpm web' }, test: 'pnpm t' },
    });
    db.insert(repoSettings)
      .values({
        repoId: REPO_ID,
        overrides: JSON.stringify({ scripts: { run: 'make dev', test: 'make test' } }),
      })
      .run();

    expect((await bundleAtMain())?.content.chord).toEqual({ setup: 'pnpm i' });
  });

  it('keeps run and test for an adopted checkout, dropping only the teardown', async () => {
    await commitTeamFile({
      scripts: { run: { web: 'pnpm web' }, test: 'pnpm test', teardown: 'make down' },
    });
    const config = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });
    const chord = collectChordScripts(config);

    expect(selectCheckoutScripts(chord, 'adopted')).toEqual({
      run: { web: 'pnpm web' },
      test: 'pnpm test',
    });
    expect(selectCheckoutScripts(chord, 'chord')).toEqual(chord);
  });
});
