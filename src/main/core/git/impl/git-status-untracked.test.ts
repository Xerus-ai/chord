import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { GitService } from './git-service';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/**
 * Settings › Git › Source control group order can only put Untracked first if
 * the status keeps untracked files apart (three areas: unstaged, staged,
 * untracked). A new file is neither a change to a tracked file nor staged.
 */
describe('GitService.getFullStatus untracked files', () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-status-untracked-'));
    await git(repo, 'init', '-q', '-b', 'main');
    await git(repo, 'config', 'user.email', 'test@example.com');
    await git(repo, 'config', 'user.name', 'Chord Test');
    await git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'one\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'base');
  });

  afterEach(() => {
    removeDirSync(repo);
  });

  it('lists a new file under untracked, not under unstaged', async () => {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'one\nstaged\n');
    await git(repo, 'add', 'staged.txt');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'a\nb\nc\n');
    const ctx = new LocalExecutionContext({ root: repo });
    const service = new GitService(ctx, ctx, new LocalFileSystem(repo));

    const status = await service.getFullStatus();

    expect(status.unstaged.map((c) => c.path)).toEqual(['tracked.txt']);
    expect(status.staged.map((c) => c.path)).toEqual(['staged.txt']);
    expect(status.untracked).toEqual([
      { path: 'new.txt', status: 'added', additions: 3, deletions: 0 },
    ]);
  });
});
