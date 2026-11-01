import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeWorktreeTree } from '@main/core/checkpoints/checkpoint-git';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';
import type { RootOperation } from './solo-types';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

interface RunGitOptions {
  env?: NodeJS.ProcessEnv;
  /** Written to the command's stdin (for `--stdin` path lists). */
  input?: string;
}

export async function runGit(
  repoPath: string,
  args: string[],
  options: RunGitOptions = {}
): Promise<string> {
  const pending = execFileAsync(GIT_EXECUTABLE, ['-c', 'core.quotepath=false', ...args], {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
  // Close stdin without writing to it unless there is input: a write (even of
  // an empty chunk) to a git that has already exited raises EPIPE on Linux.
  if (options.input === undefined) pending.child.stdin?.end();
  else pending.child.stdin?.end(options.input);
  return (await pending).stdout;
}

function splitNul(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

export async function resolveGitDir(repoPath: string): Promise<string> {
  return (await runGit(repoPath, ['rev-parse', '--absolute-git-dir'])).trim();
}

export async function resolveCommonGitDir(repoPath: string): Promise<string> {
  const out = await runGit(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const resolved = path.resolve(out.trim());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function resolveHead(repoPath: string): Promise<string> {
  return (await runGit(repoPath, ['rev-parse', '--verify', 'HEAD'])).trim();
}

/** The checked-out branch's short name, or null when HEAD is detached. */
export async function resolveBranch(repoPath: string): Promise<string | null> {
  const fullName = (await runGit(repoPath, ['rev-parse', '--symbolic-full-name', 'HEAD'])).trim();
  return fullName.startsWith('refs/heads/') ? fullName.slice('refs/heads/'.length) : null;
}

/** The multi-step git operation the checkout is in the middle of, if any. */
export function detectRootOperation(gitDir: string): RootOperation | null {
  const markers: Array<[string, RootOperation]> = [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
  ];
  const found = markers.find(([marker]) => existsSync(path.join(gitDir, marker)));
  return found ? found[1] : null;
}

/** Every path `git status` reports (staged, unstaged, untracked file by file), sorted. */
export async function listDirtyPaths(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--untracked-files=all',
  ]);
  return [...new Set(splitNul(out).map((entry) => entry.slice(3)))].sort();
}

/** Paths whose content differs between two tree-ishes, sorted. */
export async function diffTreePaths(repoPath: string, from: string, to: string): Promise<string[]> {
  const out = await runGit(repoPath, [
    'diff-tree',
    '-r',
    '-z',
    '--no-renames',
    '--name-only',
    from,
    to,
  ]);
  return splitNul(out).sort();
}

/**
 * Commits the lane checkout's full state (tracked changes + untracked,
 * non-ignored files) on its HEAD through a temp index, queued with the lane's
 * other index writers. The lane's index and files are never touched.
 */
export async function snapshotLane(
  lanePath: string,
  laneId: string
): Promise<{ laneHead: string; snapshotCommit: string }> {
  return enqueueRepoIndexOp(lanePath, async () => {
    const laneHead = await resolveHead(lanePath);
    const tree = await writeWorktreeTree(lanePath, laneHead);
    const message = `Chord Solo snapshot of lane ${laneId}`;
    const snapshotCommit = (
      await runGit(lanePath, ['commit-tree', tree, '-p', laneHead, '-m', message])
    ).trim();
    return { laneHead, snapshotCommit };
  });
}

/** Deletes a root file and the folders its removal leaves empty. */
export async function removeFileAndEmptyParents(rootPath: string, file: string): Promise<void> {
  await rm(path.join(rootPath, file), { force: true });
  let dir = path.dirname(file);
  while (dir !== '.' && existsSync(path.join(rootPath, dir))) {
    if ((await readdir(path.join(rootPath, dir))).length > 0) return;
    await rmdir(path.join(rootPath, dir));
    dir = path.dirname(dir);
  }
}

/**
 * Makes each of `paths` in the root's working tree match `targetCommit`:
 * paths absent from it are deleted (with folders left empty), the rest are
 * written by `checkout-index` from a temp index, which replaces whatever is in
 * the way. Only these paths are touched, so every other file keeps its bytes.
 */
export async function rewriteRootPaths(
  rootPath: string,
  targetCommit: string,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  const targetFiles = new Set(
    splitNul(await runGit(rootPath, ['ls-tree', '-r', '-z', '--name-only', targetCommit]))
  );
  for (const file of paths.filter((entry) => !targetFiles.has(entry))) {
    await removeFileAndEmptyParents(rootPath, file);
  }
  const writes = paths.filter((entry) => targetFiles.has(entry));
  if (writes.length === 0) return;
  const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `chord-solo-index-${randomUUID()}`) };
  try {
    await runGit(rootPath, ['read-tree', targetCommit], { env });
    await runGit(rootPath, ['checkout-index', '-f', '-z', '--stdin'], {
      env,
      input: writes.join('\0'),
    });
  } finally {
    await rm(env.GIT_INDEX_FILE, { force: true });
  }
}

/** Points the root's HEAD at a branch, or detaches it at a commit. No hooks run. */
export async function setRootHead(
  rootPath: string,
  head: { branch: string | null; commit: string }
): Promise<void> {
  if (head.branch === null) {
    await runGit(rootPath, ['update-ref', '--no-deref', '-m', 'chord solo', 'HEAD', head.commit]);
  } else {
    await runGit(rootPath, [
      'symbolic-ref',
      '-m',
      'chord solo',
      'HEAD',
      `refs/heads/${head.branch}`,
    ]);
  }
}

/**
 * Loads `commit` into the root's real index, keeping cached stat info for
 * entries that already match (`--reset`, a one-way merge like a mixed reset,
 * which unlike `-m` accepts entries with unstaged changes — the normal state
 * of a Solo root). It is the first write a root move makes, so a root whose
 * index another git process holds fails here, before any file changes.
 */
export async function loadRootIndex(rootPath: string, commit: string): Promise<void> {
  await runGit(rootPath, ['read-tree', '--reset', commit]);
}

/** Resets the real index to HEAD (mixed), leaving files as they are, and refreshes it. */
export async function refreshRootIndex(rootPath: string): Promise<void> {
  await runGit(rootPath, ['reset', '-q']);
}

/**
 * How the root differs from the last snapshot Solo applied: the root's
 * current state as a tree (seeded from its HEAD, so a commit made in the root
 * during Solo is part of it), and the paths it changed — edits, deletions,
 * new non-ignored files, and the files of any such commit — sorted.
 */
export async function listRootChanges(
  rootPath: string,
  applied: { laneHead: string; snapshotCommit: string }
): Promise<{ tree: string; files: string[] }> {
  const head = await resolveHead(rootPath);
  const tree = await writeWorktreeTree(rootPath, head);
  const files = new Set(await diffTreePaths(rootPath, `${applied.snapshotCommit}^{tree}`, tree));
  if (head !== applied.laneHead) {
    for (const file of await diffTreePaths(rootPath, applied.laneHead, head)) files.add(file);
  }
  return { tree, files: [...files].sort() };
}

/**
 * The ignored paths present in the checkout under the rules its working tree
 * has now, a wholly ignored folder as one `dir/` entry (so a large ignored
 * tree such as `node_modules/` costs one line), sorted.
 */
export async function listIgnoredEntries(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  ]);
  return splitNul(out).sort();
}

/** Untracked files git does not ignore, file by file, sorted. */
export async function listUntrackedFiles(repoPath: string): Promise<string[]> {
  const out = await runGit(repoPath, ['ls-files', '-z', '--others', '--exclude-standard']);
  return splitNul(out).sort();
}

/**
 * Refreshes the stat info of the root's index entries and nothing else: no
 * ref is locked, so it works while another git process holds `HEAD.lock`.
 */
export async function refreshRootIndexStat(rootPath: string): Promise<void> {
  await runGit(rootPath, ['update-index', '-q', '--refresh']);
}
