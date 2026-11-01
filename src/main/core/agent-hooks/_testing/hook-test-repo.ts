import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * A real repository for the hook-config suites, with git run under an empty
 * global config: Claude Code adds `**\/.claude/settings.local.json` to the
 * user's global excludes, which would otherwise hide a file Chord wrote into
 * the checkout.
 *
 * Lives under `_testing/` because vitest excludes `**\/_*\/**` from its test
 * globs, so the file is a helper and never a suite.
 */
export interface HookTestRepo {
  root: string;
  repo: string;
  /** Chord's own directory for per-session launch files, outside the checkout. */
  launchDir: string;
  git: (cwd: string, ...args: string[]) => string;
  porcelain: (cwd: string) => string;
  /** The file `.git/info/exclude` resolves to for `cwd` (shared by linked worktrees). */
  excludeFile: (cwd: string) => string;
  remove: () => void;
}

export function createHookTestRepo(options: { gitignore: string | null }): HookTestRepo {
  const root = mkdtempSync(join(tmpdir(), 'hook-config-'));
  const repo = join(root, 'repo');
  const launchDir = join(root, 'chord-profile', 'agent-launch');
  const emptyGlobalConfig = join(root, 'empty.gitconfig');
  writeFileSync(emptyGlobalConfig, '');

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_CONFIG_NOSYSTEM: '1' },
    });

  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord test');
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  if (options.gitignore !== null) writeFileSync(join(repo, '.gitignore'), options.gitignore);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');

  return {
    root,
    repo,
    launchDir,
    git,
    porcelain: (cwd) => git(cwd, 'status', '--porcelain', '--untracked-files=all'),
    excludeFile: (cwd) => resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'info/exclude').trim()),
    remove: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}
