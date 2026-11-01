import type { FullGitStatus, GitChange } from '@shared/git';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { mapStatus, MAX_DIFF_CONTENT_BYTES } from './git-utils';
import {
  MAX_STATUS_FILES,
  StatusParser,
  TooManyFilesChangedError,
  type IFileStatus,
} from './status-parser';

export function parseNumstat(
  stdout: string
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const l of stdout
    .trim()
    .split('\n')
    .filter((s) => s.trim())) {
    const [addStr, delStr, ...pathParts] = l.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath) continue;
    const existing = map.get(filePath) ?? { additions: 0, deletions: 0 };
    existing.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
    existing.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
    map.set(filePath, existing);
  }
  return map;
}

async function runStatusZ(ctx: IExecutionContext, parser: StatusParser): Promise<void> {
  await ctx.execStreaming(
    GIT_EXECUTABLE,
    ['--no-optional-locks', 'status', '-z', '-uall'],
    (chunk) => {
      parser.update(chunk);
      return !parser.tooManyFiles;
    }
  );
  if (parser.tooManyFiles) throw new TooManyFilesChangedError();
}

async function buildFullGitStatus(
  entries: IFileStatus[],
  stagedNumstat: Map<string, { additions: number; deletions: number }>,
  unstagedNumstat: Map<string, { additions: number; deletions: number }>,
  currentBranch: string | null,
  fs: FileSystemProvider
): Promise<FullGitStatus> {
  const staged: GitChange[] = [];
  const unstaged: GitChange[] = [];
  const untracked: GitChange[] = [];

  for (const e of entries) {
    const code = `${e.x}${e.y}`;
    const filePath = e.path;
    const status = mapStatus(code);

    if (e.x !== ' ' && e.x !== '?') {
      const ns = stagedNumstat.get(filePath);
      staged.push({
        path: filePath,
        status,
        additions: ns?.additions ?? 0,
        deletions: ns?.deletions ?? 0,
      });
    }

    const isUntracked = code === '??';
    const hasUnstaged = code[1] !== ' ' && code[1] !== '?';
    if (!isUntracked && !hasUnstaged) {
      continue;
    }

    let additions = unstagedNumstat.get(filePath)?.additions ?? 0;
    const deletions = unstagedNumstat.get(filePath)?.deletions ?? 0;

    if (additions === 0 && deletions === 0 && code.includes('?')) {
      try {
        const result = await fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
        if (!result.truncated) {
          additions = (result.content.match(/\n/g) ?? []).length;
        }
      } catch {}
    }

    // A new file is neither a change to a tracked file nor staged: its own
    // group, so the Changes panel can order it (Settings › Git).
    (isUntracked ? untracked : unstaged).push({
      path: filePath,
      status,
      additions,
      deletions,
    });
  }

  const totalAdded = staged.reduce((s, c) => s + c.additions, 0);
  const totalDeleted = staged.reduce((s, c) => s + c.deletions, 0);

  return { staged, unstaged, untracked, currentBranch, totalAdded, totalDeleted };
}

export async function loadFullStatus(
  ctx: IExecutionContext,
  fs: FileSystemProvider,
  getCurrentBranch: () => Promise<string | null>
): Promise<FullGitStatus> {
  try {
    const parser = new StatusParser();
    const [, stagedRes, unstagedRes, currentBranch] = await Promise.all([
      runStatusZ(ctx, parser),
      ctx.exec(GIT_EXECUTABLE, ['diff', '--numstat', '--cached']).catch(() => ({
        stdout: '',
      })),
      ctx.exec(GIT_EXECUTABLE, ['diff', '--numstat']).catch(() => ({ stdout: '' })),
      getCurrentBranch(),
    ]);

    const stagedNumstat = parseNumstat(stagedRes.stdout);
    const unstagedNumstat = parseNumstat(unstagedRes.stdout);

    if (parser.status.length > MAX_STATUS_FILES || parser.tooManyFiles) {
      throw new TooManyFilesChangedError();
    }

    return await buildFullGitStatus(
      parser.status,
      stagedNumstat,
      unstagedNumstat,
      currentBranch,
      fs
    );
  } catch (e) {
    if (e instanceof TooManyFilesChangedError) throw e;
    return {
      staged: [],
      unstaged: [],
      untracked: [],
      currentBranch: null,
      totalAdded: 0,
      totalDeleted: 0,
    };
  }
}

export async function getStatus(
  getFullStatus: () => Promise<FullGitStatus>
): Promise<{ changes: GitChange[]; currentBranch: string | null }> {
  try {
    const full = await getFullStatus();
    const byPath = new Map<string, GitChange>();
    for (const c of full.staged) {
      byPath.set(c.path, { ...c });
    }
    for (const c of [...full.unstaged, ...full.untracked]) {
      const prev = byPath.get(c.path);
      if (prev) {
        byPath.set(c.path, {
          path: c.path,
          status: c.status,
          additions: prev.additions + c.additions,
          deletions: prev.deletions + c.deletions,
        });
      } else {
        byPath.set(c.path, c);
      }
    }
    return { changes: [...byPath.values()], currentBranch: full.currentBranch };
  } catch (e) {
    if (e instanceof TooManyFilesChangedError) throw e;
    return { changes: [], currentBranch: null };
  }
}

export async function getStagedChanges(getFullStatus: () => Promise<FullGitStatus>): Promise<{
  changes: GitChange[];
  totalAdded: number;
  totalDeleted: number;
}> {
  try {
    const full = await getFullStatus();
    return {
      changes: full.staged,
      totalAdded: full.totalAdded,
      totalDeleted: full.totalDeleted,
    };
  } catch (e) {
    if (e instanceof TooManyFilesChangedError) {
      return { changes: [], totalAdded: 0, totalDeleted: 0 };
    }
    throw e;
  }
}

export async function getUnstagedChanges(
  getFullStatus: () => Promise<FullGitStatus>
): Promise<{ changes: GitChange[] }> {
  try {
    const full = await getFullStatus();
    return { changes: [...full.unstaged, ...full.untracked] };
  } catch (e) {
    if (e instanceof TooManyFilesChangedError) {
      return { changes: [] };
    }
    throw e;
  }
}

export async function stageFiles(ctx: IExecutionContext, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  await ctx.exec(GIT_EXECUTABLE, ['add', '--', ...filePaths]);
}

export async function stageAllFiles(ctx: IExecutionContext): Promise<void> {
  await ctx.exec(GIT_EXECUTABLE, ['add', '-A']);
}

export async function unstageFiles(ctx: IExecutionContext, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  try {
    await ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD', '--', ...filePaths]);
  } catch {
    for (const filePath of filePaths) {
      try {
        await ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD', '--', filePath]);
      } catch {
        await ctx.exec(GIT_EXECUTABLE, ['rm', '--cached', '--', filePath]);
      }
    }
  }
}

export async function unstageAllFiles(ctx: IExecutionContext): Promise<void> {
  try {
    await ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD']);
  } catch {
    // Repo may have no commits yet; ignore.
  }
}

export async function revertFiles(
  ctx: IExecutionContext,
  fs: FileSystemProvider,
  filePaths: string[]
): Promise<void> {
  if (filePaths.length === 0) return;

  let trackedPaths = new Set<string>();
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'ls-tree',
      '--name-only',
      'HEAD',
      '--',
      ...filePaths,
    ]);
    trackedPaths = new Set(stdout.trim().split('\n').filter(Boolean));
  } catch {
    // Empty repo — no HEAD yet, all files are untracked
  }

  const tracked = filePaths.filter((f) => trackedPaths.has(f));
  const untracked = filePaths.filter((f) => !trackedPaths.has(f));

  if (tracked.length > 0) {
    await ctx.exec(GIT_EXECUTABLE, ['checkout', 'HEAD', '--', ...tracked]);
  }

  for (const filePath of untracked) {
    try {
      const exists = await fs.exists(filePath);
      if (exists) await fs.remove(filePath);
    } catch {}
  }
}

export async function revertAllFiles(ctx: IExecutionContext): Promise<void> {
  try {
    await ctx.exec(GIT_EXECUTABLE, ['reset', '--hard', 'HEAD']);
  } catch {
    // Repo may have no commits yet; ignore.
  }
  await ctx.exec(GIT_EXECUTABLE, ['clean', '-fd']);
}

/**
 * Every path `.gitignore` excludes, with wholly ignored directories collapsed
 * to one entry each.
 *
 * `--directory` is the whole point: without it a repository with
 * `node_modules` reports forty thousand paths to answer a question the file
 * tree asks about a few dozen visible rows. With it the answer is a list of
 * prefixes, which is what the renderer matches against.
 */
export async function listIgnoredPaths(ctx: IExecutionContext): Promise<string[]> {
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  ]);
  return stdout.split('\n').filter(Boolean);
}
