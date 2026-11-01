import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { RepoConfigError } from './read-team-config';
import { updateJustMeSettings, writeTeamConfigFile } from './repo-settings-writes';
import { readJustMeSettings } from './resolve-repo-config';
import { TeamFileOffBaseError } from './team-file-lineage';

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
 * The repository page's two write paths: "Just me" values go to this
 * machine's `repo_settings` row; a team value is written to the main
 * checkout's `.chord.json` and left there, uncommitted, for the user to
 * commit — Chord never commits or pushes it.
 */
describe('updateJustMeSettings', () => {
  beforeEach(() => {
    db.insert(repos).values({ id: REPO_ID, path: '/repo', alias: 'repo' }).run();
  });

  afterEach(() => {
    db.delete(repos).run();
  });

  it('stores a value, merging with what is already there', () => {
    updateJustMeSettings(REPO_ID, { agentStart: 'immediately' });
    updateJustMeSettings(REPO_ID, { keepLocalBaseUpToDate: true });

    expect(readJustMeSettings(REPO_ID)).toEqual({
      agentStart: 'immediately',
      keepLocalBaseUpToDate: true,
    });
  });

  it('clears a value set to null, so the next layer down applies again', () => {
    updateJustMeSettings(REPO_ID, { baseBranch: 'develop', agentStart: 'immediately' });
    updateJustMeSettings(REPO_ID, { baseBranch: null });

    expect(readJustMeSettings(REPO_ID)).toEqual({ agentStart: 'immediately' });
  });

  it('merges scripts one at a time, and drops the group once empty', () => {
    updateJustMeSettings(REPO_ID, { scripts: { setup: 'pnpm i', teardown: 'make down' } });
    updateJustMeSettings(REPO_ID, { scripts: { setup: null } });
    expect(readJustMeSettings(REPO_ID)).toEqual({ scripts: { teardown: 'make down' } });

    updateJustMeSettings(REPO_ID, { scripts: { teardown: null } });
    expect(readJustMeSettings(REPO_ID)).toEqual({});
  });

  it('replaces the whole run value, never merging named scripts per id', () => {
    updateJustMeSettings(REPO_ID, {
      scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
    });
    updateJustMeSettings(REPO_ID, { scripts: { run: { web: 'pnpm web --port 4000' } } });
    expect(readJustMeSettings(REPO_ID)).toEqual({
      scripts: { run: { web: 'pnpm web --port 4000' }, test: 'pnpm test' },
    });

    updateJustMeSettings(REPO_ID, { scripts: { run: 'make dev' } });
    expect(readJustMeSettings(REPO_ID).scripts?.run).toBe('make dev');

    updateJustMeSettings(REPO_ID, { scripts: { run: null, test: null } });
    expect(readJustMeSettings(REPO_ID)).toEqual({});
  });

  it('refuses a run object naming `default` or a bad id, and stores nothing', () => {
    updateJustMeSettings(REPO_ID, { scripts: { test: 'pnpm test' } });

    expect(() =>
      updateJustMeSettings(REPO_ID, { scripts: { run: { default: 'pnpm dev' } } })
    ).toThrow();
    expect(() =>
      updateJustMeSettings(REPO_ID, { scripts: { run: { Web: 'pnpm web' } } })
    ).toThrow();
    expect(readJustMeSettings(REPO_ID)).toEqual({ scripts: { test: 'pnpm test' } });
  });

  it('refuses a just-me run mode: whether the app can run twice is the team file’s to say', () => {
    expect(() =>
      updateJustMeSettings(REPO_ID, { runMode: 'solo' } as unknown as Parameters<
        typeof updateJustMeSettings
      >[1])
    ).toThrow();
    expect(readJustMeSettings(REPO_ID)).toEqual({});
  });

  it('refuses an invalid value and stores nothing', () => {
    updateJustMeSettings(REPO_ID, { agentStart: 'immediately' });

    expect(() => updateJustMeSettings(REPO_ID, { worktreeFolder: 'relative/lanes' })).toThrow();
    expect(readJustMeSettings(REPO_ID)).toEqual({ agentStart: 'immediately' });
  });

  it('refuses a repository that does not exist', () => {
    expect(() => updateJustMeSettings('missing', { agentStart: 'immediately' })).toThrow(/missing/);
  });
});

describe('writeTeamConfigFile', () => {
  // The repository has no remote, so its base is the branch first checked out.
  const BASE = 'main';
  let repoDir: string;
  const teamFile = () => path.join(repoDir, '.chord.json');

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-write-'));
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(
      teamFile(),
      JSON.stringify({ shellSetup: 'source .envrc', scripts: { setup: 'pnpm i' } })
    );
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'team config'], repoDir);
  });

  afterEach(() => {
    removeDirSync(repoDir);
  });

  it('writes the change into the main checkout as an uncommitted edit, keeping the other keys', async () => {
    const head = await git(['rev-parse', 'HEAD'], repoDir);

    const result = await writeTeamConfigFile(repoDir, BASE, {
      baseBranch: 'develop',
      scripts: { teardown: 'make down' },
    });

    expect(result).toEqual({ path: teamFile() });
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
      scripts: { setup: 'pnpm i', teardown: 'make down' },
      baseBranch: 'develop',
    });
    expect(await git(['rev-parse', 'HEAD'], repoDir)).toBe(head);
    expect(await git(['status', '--porcelain', '--', '.chord.json'], repoDir)).toBe(
      'M .chord.json'
    );
  });

  it('removes a key set to null, and the scripts group once it is empty', async () => {
    await writeTeamConfigFile(repoDir, BASE, { scripts: { setup: null } });

    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
    });
  });

  it('applies the change on top of an uncommitted edit already in the checkout', async () => {
    await writeTeamConfigFile(repoDir, BASE, { baseBranch: 'develop' });
    await writeTeamConfigFile(repoDir, BASE, { scripts: { run: 'pnpm dev' } });

    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
      scripts: { setup: 'pnpm i', run: 'pnpm dev' },
      baseBranch: 'develop',
    });
  });

  it('creates the file when neither the checkout nor the base has one', async () => {
    await git(['rm', '-q', '.chord.json'], repoDir);
    await git(['commit', '-m', 'no team config'], repoDir);

    await writeTeamConfigFile(repoDir, BASE, { filesToCopy: ['.env', '.env.local'] });

    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      filesToCopy: ['.env', '.env.local'],
    });
  });

  // devstation-1q1: the page shows the file at the base, so a write that
  // starts from a different one would drop or change values the user saw.
  it("refuses when the checkout's branch has no .chord.json and the base has one", async () => {
    await git(['checkout', '-q', '-b', 'feat/no-config'], repoDir);
    await git(['rm', '-q', '.chord.json'], repoDir);
    await git(['commit', '-m', 'drop team config'], repoDir);

    const write = writeTeamConfigFile(repoDir, BASE, { scripts: { run: 'pnpm dev' } });

    await expect(write).rejects.toBeInstanceOf(TeamFileOffBaseError);
    await expect(write).rejects.toThrow(/feat\/no-config.*main/);
    expect(fs.existsSync(teamFile())).toBe(false);
  });

  it("refuses when the checkout's branch has its own committed .chord.json", async () => {
    await git(['checkout', '-q', '-b', 'feat/old-config'], repoDir);
    fs.writeFileSync(teamFile(), JSON.stringify({ scripts: { setup: 'npm ci' } }));
    await git(['commit', '-q', '-am', 'older team config'], repoDir);

    await expect(
      writeTeamConfigFile(repoDir, BASE, { scripts: { run: 'pnpm dev' } })
    ).rejects.toBeInstanceOf(TeamFileOffBaseError);
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      scripts: { setup: 'npm ci' },
    });
  });

  it('refuses to edit a file it cannot parse, and leaves it as it was', async () => {
    fs.writeFileSync(teamFile(), '{ "scripts": ');

    await expect(
      writeTeamConfigFile(repoDir, BASE, { baseBranch: 'develop' })
    ).rejects.toBeInstanceOf(RepoConfigError);
    expect(fs.readFileSync(teamFile(), 'utf8')).toBe('{ "scripts": ');
  });

  it('refuses a change that would make the file invalid', async () => {
    await expect(writeTeamConfigFile(repoDir, BASE, { baseBranch: '  ' })).rejects.toBeInstanceOf(
      RepoConfigError
    );
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
      scripts: { setup: 'pnpm i' },
    });
  });

  // Phase 4 (devstation-5b3.1): run scripts, the test script and the run mode.
  it('writes named run scripts, the test script and the run mode', async () => {
    await writeTeamConfigFile(repoDir, BASE, {
      runMode: 'solo',
      scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
    });

    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
      scripts: {
        setup: 'pnpm i',
        run: { web: 'pnpm web', api: 'pnpm api' },
        test: 'pnpm test',
      },
      runMode: 'solo',
    });
  });

  it('replaces the whole run value, and clears the run mode on null', async () => {
    await writeTeamConfigFile(repoDir, BASE, {
      runMode: 'solo',
      scripts: { run: { web: 'pnpm web', api: 'pnpm api' } },
    });
    await writeTeamConfigFile(repoDir, BASE, { scripts: { run: { web: 'pnpm web2' } } });
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8')).scripts.run).toEqual({
      web: 'pnpm web2',
    });

    await writeTeamConfigFile(repoDir, BASE, { runMode: null, scripts: { run: 'pnpm dev' } });
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8'))).toEqual({
      shellSetup: 'source .envrc',
      scripts: { setup: 'pnpm i', run: 'pnpm dev' },
    });

    await writeTeamConfigFile(repoDir, BASE, { scripts: { run: null } });
    expect(JSON.parse(fs.readFileSync(teamFile(), 'utf8')).scripts).toEqual({ setup: 'pnpm i' });
  });

  it('refuses a run object naming `default`, or a bad id, and leaves the file as it was', async () => {
    const before = fs.readFileSync(teamFile(), 'utf8');

    await expect(
      writeTeamConfigFile(repoDir, BASE, { scripts: { run: { default: 'pnpm dev' } } })
    ).rejects.toBeInstanceOf(RepoConfigError);
    await expect(
      writeTeamConfigFile(repoDir, BASE, { scripts: { run: { 'web.api': 'pnpm dev' } } })
    ).rejects.toBeInstanceOf(RepoConfigError);
    expect(fs.readFileSync(teamFile(), 'utf8')).toBe(before);
  });
});
