import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { RepoConfigError } from './read-team-config';
import { readJustMeSettings, resolveRepoConfig } from './resolve-repo-config';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const REPO_ID = 'repo-1';

describe('resolveRepoConfig', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-cfg-'));
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    await git(['commit', '--allow-empty', '-m', 'init'], repoDir);
    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
  });

  afterEach(() => {
    db.delete(repos).run();
    removeDirSync(repoDir);
  });

  async function commitTeamFile(config: object): Promise<void> {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), JSON.stringify(config));
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'team config'], repoDir);
  }

  function setOverrides(overrides: string): void {
    db.insert(repoSettings)
      .values({ repoId: REPO_ID, overrides })
      .onConflictDoUpdate({ target: repoSettings.repoId, set: { overrides } })
      .run();
  }

  it('reports built-in defaults as the default layer', async () => {
    const resolved = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });

    expect(resolved.oid).toBeNull();
    expect(resolved.filesToCopy).toEqual({ value: ['.env*', '.envrc'], layer: 'default' });
    expect(resolved.agentStart).toEqual({ value: 'waitForSetup', layer: 'default' });
    expect(resolved.baseBranch).toEqual({ value: null, layer: 'default' });
    expect(resolved.scripts.setup).toEqual({ value: null, layer: 'default' });
    expect(resolved.scripts.run).toEqual({ value: {}, layer: 'default' });
    expect(resolved.scripts.test).toEqual({ value: null, layer: 'default' });
    expect(resolved.runMode).toEqual({ value: 'perWorktree', layer: 'default' });
  });

  it('takes team values from the file at the ref', async () => {
    await commitTeamFile({ filesToCopy: ['.env'], scripts: { setup: 'pnpm i' } });

    const resolved = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });

    expect(resolved.oid).toBe(await git(['rev-parse', 'main:.chord.json'], repoDir));
    expect(resolved.filesToCopy).toEqual({ value: ['.env'], layer: 'team' });
    expect(resolved.scripts).toEqual({
      setup: { value: 'pnpm i', layer: 'team' },
      run: { value: {}, layer: 'default' },
      test: { value: null, layer: 'default' },
      teardown: { value: null, layer: 'default' },
    });
  });

  it("lets a just-me script replace the team's, per script", async () => {
    await commitTeamFile({ scripts: { setup: 'pnpm i', teardown: 'make down' } });
    setOverrides(JSON.stringify({ scripts: { setup: 'pnpm i --offline', run: 'pnpm dev' } }));

    const resolved = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });

    expect(resolved.scripts).toEqual({
      setup: { value: 'pnpm i --offline', layer: 'justMe' },
      run: { value: { default: 'pnpm dev' }, layer: 'justMe' },
      test: { value: null, layer: 'default' },
      teardown: { value: 'make down', layer: 'team' },
    });
  });

  it('keeps the local base up to date only when the user turned it on', async () => {
    const before = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });
    expect(before.keepLocalBaseUpToDate).toEqual({ value: false, layer: 'default' });

    setOverrides(JSON.stringify({ keepLocalBaseUpToDate: true }));
    const after = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });
    expect(after.keepLocalBaseUpToDate).toEqual({ value: true, layer: 'justMe' });
  });

  it('reads a just-me worktree folder only as an absolute path', () => {
    const absolute = path.join(os.tmpdir(), 'lanes');
    setOverrides(JSON.stringify({ worktreeFolder: absolute }));
    expect(readJustMeSettings(REPO_ID).worktreeFolder).toBe(absolute);

    setOverrides(JSON.stringify({ worktreeFolder: 'lanes' }));
    expect(() => readJustMeSettings(REPO_ID)).toThrow();
  });

  it('lets just-me settings override the team file, per key', async () => {
    await commitTeamFile({ baseBranch: 'develop', filesToCopy: ['.env'] });
    setOverrides(JSON.stringify({ baseBranch: 'release', agentStart: 'immediately' }));

    const resolved = await resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });

    expect(resolved.baseBranch).toEqual({ value: 'release', layer: 'justMe' });
    expect(resolved.agentStart).toEqual({ value: 'immediately', layer: 'justMe' });
    expect(resolved.filesToCopy).toEqual({ value: ['.env'], layer: 'team' });
  });

  it('throws on stored just-me settings it cannot read', () => {
    setOverrides('{ not json');
    expect(() => readJustMeSettings(REPO_ID)).toThrow();

    setOverrides(JSON.stringify({ agentStart: 'whenever' }));
    expect(() => readJustMeSettings(REPO_ID)).toThrow();
  });

  it('has no just-me settings for a work item without a repository row', () => {
    expect(readJustMeSettings(null)).toEqual({});
  });
  // Phase 4 (devstation-5b3.1): run scripts, the test script and the run mode.
  describe('run and test', () => {
    const resolve = () => resolveRepoConfig({ repoId: REPO_ID, repoPath: repoDir, ref: 'main' });

    it('reads a team run string as the default script', async () => {
      await commitTeamFile({ scripts: { run: 'pnpm dev' } });

      expect((await resolve()).scripts.run).toEqual({
        value: { default: 'pnpm dev' },
        layer: 'team',
      });
    });

    it('reads named team run scripts, the test script and the run mode', async () => {
      await commitTeamFile({
        runMode: 'solo',
        scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
      });

      const resolved = await resolve();

      expect(resolved.scripts.run).toEqual({
        value: { web: 'pnpm web', api: 'pnpm api' },
        layer: 'team',
      });
      expect(resolved.scripts.test).toEqual({ value: 'pnpm test', layer: 'team' });
      expect(resolved.runMode).toEqual({ value: 'solo', layer: 'team' });
    });

    it("lets a just-me run replace the team's run scripts entirely, not per id", async () => {
      await commitTeamFile({ scripts: { run: { web: 'pnpm web', api: 'pnpm api' } } });
      setOverrides(JSON.stringify({ scripts: { run: { web: 'pnpm web --port 4000' } } }));

      expect((await resolve()).scripts.run).toEqual({
        value: { web: 'pnpm web --port 4000' },
        layer: 'justMe',
      });
    });

    it("lets a just-me string run and test replace the team's", async () => {
      await commitTeamFile({ scripts: { run: { web: 'pnpm web' }, test: 'pnpm test' } });
      setOverrides(JSON.stringify({ scripts: { run: 'make dev', test: 'make test' } }));

      const resolved = await resolve();

      expect(resolved.scripts.run).toEqual({ value: { default: 'make dev' }, layer: 'justMe' });
      expect(resolved.scripts.test).toEqual({ value: 'make test', layer: 'justMe' });
    });

    it('refuses `default` as a named run script id, saying to use a string', async () => {
      await commitTeamFile({ scripts: { run: { default: 'pnpm dev', web: 'pnpm web' } } });

      const read = resolve();
      await expect(read).rejects.toBeInstanceOf(RepoConfigError);
      await expect(read).rejects.toThrow(/scripts\.run\.default:.*string/);
    });

    it('refuses a run script id outside the allowed form, naming it', async () => {
      await commitTeamFile({ scripts: { run: { Web: 'pnpm web' } } });

      const read = resolve();
      await expect(read).rejects.toBeInstanceOf(RepoConfigError);
      await expect(read).rejects.toThrow(
        /scripts\.run\.Web:.*lowercase letters, digits and dashes/
      );
    });

    it('refuses a run value that is neither a command nor named commands', async () => {
      await commitTeamFile({ scripts: { run: ['pnpm dev'] } });
      await expect(resolve()).rejects.toThrow(/scripts\.run/);

      await commitTeamFile({ scripts: { run: { web: 3 } } });
      await expect(resolve()).rejects.toThrow(/scripts\.run/);
    });

    it('refuses an unknown run mode', async () => {
      await commitTeamFile({ runMode: 'shared' });

      const read = resolve();
      await expect(read).rejects.toBeInstanceOf(RepoConfigError);
      await expect(read).rejects.toThrow(/runMode/);
    });

    it('keeps the run mode team-only: a stored just-me run mode is unreadable', () => {
      setOverrides(JSON.stringify({ runMode: 'solo' }));
      expect(() => readJustMeSettings(REPO_ID)).toThrow();
    });

    it('refuses a stored just-me run object with `default` or a bad id', () => {
      setOverrides(JSON.stringify({ scripts: { run: { default: 'pnpm dev' } } }));
      expect(() => readJustMeSettings(REPO_ID)).toThrow();

      setOverrides(JSON.stringify({ scripts: { run: { 'web api': 'pnpm dev' } } }));
      expect(() => readJustMeSettings(REPO_ID)).toThrow();
    });
  });
});
