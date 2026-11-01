import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { existsInHead, getStagedPaths } from './file-revert';
import { readUntrackedLineCounts } from './untracked-line-counts';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const DIFF_MAX_BUFFER = 5 * 1024 * 1024;
const FILE_LIST_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * `core.quotepath=false` on every path-producing command: with git's default
 * every non-ASCII byte comes back octal-escaped inside double quotes
 * (`"caf\303\251.txt"`), which no consumer of these paths can open, stage or
 * revert.
 */
const QUOTEPATH_OFF = ['-c', 'core.quotepath=false'];

export interface ChangedFile {
  name: string;
  added: number;
  removed: number;
  staged: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  timeAgo: string;
}

async function runGit(repoPath: string, args: string[], maxBuffer?: number): Promise<string> {
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
  });
  return stdout;
}

function splitLines(stdout: string): string[] {
  return stdout.split('\n').filter(Boolean);
}

/**
 * Every path the work item has touched relative to HEAD, with its line counts.
 *
 * `--no-renames` is what makes the rows parseable: git's rename detection emits
 * `-\t-\told => new` (or an even less splittable `dir/{a => b}/f` form), so a
 * renamed file otherwise lands in the Changes tab under a name that exists
 * nowhere on disk. Split into a delete row and an add row, both sides are real
 * paths the diff viewer and the revert action can act on.
 */
export async function readChangedFiles(repoPath: string): Promise<ChangedFile[]> {
  const numstatOut = await runGit(repoPath, [
    ...QUOTEPATH_OFF,
    'diff',
    '--numstat',
    '--no-renames',
    'HEAD',
  ]);

  const files = splitLines(numstatOut).map((line) => {
    const [added, removed, name] = line.split('\t');
    return {
      name: name ?? '',
      // Binary files report `-` for both counts.
      added: added === '-' ? 0 : parseInt(added, 10),
      removed: removed === '-' ? 0 : parseInt(removed, 10),
    };
  });

  const trackedNames = new Set(files.map((file) => file.name));
  for (const { name, added } of await readUntrackedLineCounts(repoPath)) {
    if (!trackedNames.has(name)) files.push({ name, added, removed: 0 });
  }

  // Staged files can't be one-click reverted (`checkout --` would restore the
  // index version, not HEAD) — the tab uses this to hide the icon.
  const stagedPaths = await getStagedPaths(repoPath);
  return files.map((file) => ({ ...file, staged: stagedPaths.has(file.name) }));
}

/** Tracked + untracked-but-not-ignored: what the agent can actually see. */
export async function readRepoFileList(repoPath: string): Promise<string[]> {
  const stdout = await runGit(
    repoPath,
    [...QUOTEPATH_OFF, 'ls-files', '--cached', '--others', '--exclude-standard'],
    FILE_LIST_MAX_BUFFER
  );
  return splitLines(stdout);
}

export async function readGitLog(repoPath: string, maxCount: number): Promise<GitLogEntry[]> {
  const stdout = await runGit(repoPath, ['log', `--max-count=${maxCount}`, '--format=%h\t%s\t%cr']);

  return splitLines(stdout).map((line) => {
    const parts = line.split('\t');
    return { hash: parts[0] ?? '', message: parts[1] ?? '', timeAgo: parts[2] ?? '' };
  });
}

/**
 * The two sides the diff viewer renders. An empty side is a real state — a file
 * added since HEAD has no original, a deleted one has no current content — but
 * only when git and the filesystem say so, which is why HEAD membership is
 * asked before reading rather than inferred from a failed read.
 */
export async function readFileDiff(
  repoPath: string,
  filePath: string
): Promise<{ original: string; modified: string }> {
  const original = (await existsInHead(repoPath, filePath))
    ? await runGit(repoPath, ['show', `HEAD:${filePath}`], DIFF_MAX_BUFFER)
    : '';

  let modified = '';
  try {
    modified = await readFile(resolve(repoPath, filePath), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  return { original, modified };
}
