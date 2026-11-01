import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { GitAiError } from './git-ai-errors';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const DIFF_MAX_BUFFER = 64 * 1024 * 1024;
/** git's id for the empty tree: the base of a checkout with no commit yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const UNTRACKED_BATCH = 8;

/**
 * Every command here only reads: none takes the index lock or writes a file,
 * so Generate never changes what Commit or Create PR will do.
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, ['-c', 'core.quotepath=false', ...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: DIFF_MAX_BUFFER,
  });
  return stdout;
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function readBranch(cwd: string): Promise<string | null> {
  return (await runGit(cwd, ['branch', '--show-current'])).trim() || null;
}

/** A new file as a diff from nothing; `--no-index` exits 1 when there is a difference. */
async function diffUntrackedFile(cwd: string, file: string): Promise<string> {
  try {
    return await runGit(cwd, ['diff', '--no-index', '--no-renames', '--', '/dev/null', file]);
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string };
    if (failed.code === 1 && typeof failed.stdout === 'string') return failed.stdout;
    throw error;
  }
}

/** Every uncommitted change — staged, unstaged and new files — as one diff against HEAD. */
async function readUncommittedDiff(cwd: string): Promise<string> {
  const base = (await hasHead(cwd)) ? 'HEAD' : EMPTY_TREE;
  const tracked = await runGit(cwd, ['diff', '--no-renames', base]);
  const untracked = (await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean);
  const parts = [tracked];
  for (let i = 0; i < untracked.length; i += UNTRACKED_BATCH) {
    const batch = untracked.slice(i, i + UNTRACKED_BATCH);
    parts.push(...(await Promise.all(batch.map((file) => diffUntrackedFile(cwd, file)))));
  }
  return parts.filter((part) => part.length > 0).join('');
}

export interface CommitInput {
  branch: string | null;
  diff: string;
  /** `staged` when something is staged; `all` when Commit would stage everything. */
  source: 'staged' | 'all';
}

/**
 * What Commit will commit: the staged changes, or — when nothing is staged,
 * since Chord's Commit then stages everything — every change in the checkout.
 */
export async function readCommitInput(checkout: string): Promise<CommitInput> {
  const branch = await readBranch(checkout);
  const staged = await runGit(checkout, ['diff', '--cached', '--no-renames']);
  if (staged.trim()) return { branch, diff: staged, source: 'staged' };
  const all = await readUncommittedDiff(checkout);
  if (!all.trim()) {
    throw new GitAiError({
      type: 'nothing_to_describe',
      message: 'There are no changes to commit.',
    });
  }
  return { branch, diff: all, source: 'all' };
}

export interface PullRequestInput {
  branch: string | null;
  /** `<sha> <subject>` per commit since the lane left its target, oldest first. */
  commits: string;
  /** The merge-base diff `target...HEAD`. */
  diff: string;
  /** Uncommitted changes Create PR commits before it opens the PR. */
  pendingDiff: string;
}

/**
 * What Create PR will open: the lane's commits since it left `targetRef` and
 * their merge-base diff, plus the uncommitted changes it commits first. A
 * target git cannot resolve throws — it is not "no changes".
 */
export async function readPullRequestInput(
  checkout: string,
  targetRef: string
): Promise<PullRequestInput> {
  await runGit(checkout, ['rev-parse', '--verify', `${targetRef}^{commit}`]);
  const [branch, commits, diff, pendingDiff] = await Promise.all([
    readBranch(checkout),
    runGit(checkout, ['log', '--reverse', '--no-merges', '--format=%h %s', `${targetRef}..HEAD`]),
    runGit(checkout, ['diff', '--no-renames', `${targetRef}...HEAD`]),
    readUncommittedDiff(checkout),
  ]);
  if (!commits.trim() && !pendingDiff.trim()) {
    throw new GitAiError({
      type: 'nothing_to_describe',
      message: `This branch has no commits or changes of its own against ${targetRef}.`,
    });
  }
  return { branch, commits: commits.trim(), diff, pendingDiff };
}
