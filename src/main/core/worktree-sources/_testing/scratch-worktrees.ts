import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Real repositories with checkouts made outside Chord, for the worktree
 * sources and Adopt suites (plan §Phase 3 slice 6): a bare origin, the clone
 * Chord registers, and linked worktrees added with plain `git worktree add`
 * the way Claude Code or the user would.
 *
 * Lives under `_testing/` so vitest never collects it as a suite.
 */

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

function configureIdentity(checkout: string): void {
  git(checkout, 'config', 'user.email', 'test@chord.invalid');
  git(checkout, 'config', 'user.name', 'Chord test');
}

export interface ScratchRepo {
  root: string;
  origin: string;
  /** Where commits are made and pushed to origin, standing in for a teammate. */
  seed: string;
  /** The clone Chord registers; its `origin/HEAD` names `main`. */
  repo: string;
}

/** origin (bare) with main = [README.md, .gitignore ignoring `.env*`], and its clone. */
export function createScratchRepo(prefix: string): ScratchRepo {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, seed);
  configureIdentity(seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(seed, 'README.md'), '# scratch\n');
  writeFileSync(path.join(seed, '.gitignore'), '.env*\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  configureIdentity(repo);
  return { root, origin, seed, repo };
}

/** A commit on origin's main that the registered clone has not fetched. */
export function pushCommitToOrigin(scratch: ScratchRepo, file: string): string {
  writeFileSync(path.join(scratch.seed, file), `${file}\n`);
  git(scratch.seed, 'add', file);
  git(scratch.seed, 'commit', '-q', '-m', `add ${file}`);
  git(scratch.seed, 'push', '-q', 'origin', 'main');
  return git(scratch.seed, 'rev-parse', 'HEAD');
}

/** `git worktree add` from `main`: on a new `branch`, or detached when `branch` is null. */
export function addWorktree(repo: string, dir: string, branch: string | null): string {
  mkdirSync(path.dirname(dir), { recursive: true });
  if (branch) git(repo, 'worktree', 'add', '-q', '-b', branch, dir, 'main');
  else git(repo, 'worktree', 'add', '-q', '--detach', dir, 'main');
  return dir;
}

/** Where Claude Code puts a worktree it makes: `<repo>/.claude/worktrees/<name>`. */
export function claudeWorktreePath(repo: string, name: string): string {
  return path.join(repo, '.claude', 'worktrees', name);
}

export function listGitWorktrees(repo: string): string {
  return git(repo, 'worktree', 'list', '--porcelain');
}

function readFilesUnder(dir: string, prefix = ''): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (prefix === '' && entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readFilesUnder(full, rel));
    else files[rel] = readFileSync(full, 'utf8');
  }
  return files;
}

/**
 * Everything about a checkout that "Chord never changes it" covers: its
 * commit, its branch, git's view of it (ignored files included), and every
 * file's content.
 */
export function readCheckoutState(dir: string): {
  head: string;
  branch: string;
  status: string;
  files: Record<string, string>;
} {
  return {
    head: git(dir, 'rev-parse', 'HEAD'),
    branch: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status: git(dir, 'status', '--porcelain', '--ignored'),
    files: readFilesUnder(dir),
  };
}
