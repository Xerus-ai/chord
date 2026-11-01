import {
  toRangeString,
  toRefString,
  type BranchPublication,
  type Commit,
  type CommitFile,
  type DiffMode,
  type GitChange,
  type GitObjectRef,
  type MergeBaseRange,
} from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { readBranchPublication } from './git-branch-publication';
import { parseNumstat } from './git-status-ops';
import { mapStatus } from './git-utils';

export async function getLog(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
    preferredRemote?: string;
    base?: GitObjectRef;
    head?: GitObjectRef;
  }
): Promise<{ commits: Commit[]; aheadCount: number; publication: BranchPublication }> {
  const { maxCount = 50, skip = 0, knownAheadCount, preferredRemote, base, head } = options ?? {};
  const remote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
  const headStr = head ? toRefString(head) : 'HEAD';

  // Publication is read from where Push sends the branch, never guessed from
  // the log: a lane forked from origin/main shares main's pushed commits
  // (devstation-dh2), and a repository with no remote has none (devstation-7eq).
  const branchState = await readBranchPublication(ctx, remote);
  let aheadCount = knownAheadCount ?? branchState.aheadCount;
  if (knownAheadCount === undefined && base !== undefined) {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'rev-list',
      '--count',
      `${toRefString(base)}..${headStr}`,
    ]);
    aheadCount = Number.parseInt(stdout.trim(), 10);
  }

  const FIELD_SEP = '---FIELD_SEP---';
  const RECORD_SEP = '---RECORD_SEP---';
  const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%b`;
  const rangeArg = base ? `${toRefString(base)}..${headStr}` : headStr;
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
    'log',
    `--max-count=${maxCount}`,
    `--skip=${skip}`,
    `--pretty=format:${format}`,
    rangeArg,
    '--',
  ]);

  const publication = branchState.publication;
  if (!stdout.trim()) return { commits: [], aheadCount, publication };

  const commits = stdout
    .split(RECORD_SEP)
    .filter((entry) => entry.trim())
    .map((entry, index) => {
      const parts = entry.trim().split(FIELD_SEP);
      const refs = parts[4] || '';
      const tags = refs
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.startsWith('tag: '))
        .map((r) => r.slice(5));
      return {
        hash: parts[0] || '',
        subject: parts[1] || '',
        body: (parts[5] || '').trim(),
        author: parts[2] || '',
        date: parts[3] || '',
        isPushed: skip + index >= aheadCount,
        tags,
      };
    });

  return { commits, aheadCount, publication };
}

export async function getChangedFiles(
  ctx: IExecutionContext,
  base: DiffMode | GitObjectRef | MergeBaseRange
): Promise<GitChange[]> {
  const isRange = 'base' in base;
  const isStaged = !isRange && (base as DiffMode | GitObjectRef).kind === 'staged';
  const ref = isStaged
    ? '--cached'
    : isRange
      ? toRangeString(base as MergeBaseRange)
      : toRefString(base as GitObjectRef);

  const diffArgs = isStaged ? ['diff', '--numstat', '--cached'] : ['diff', '--numstat', ref];
  const nameArgs = isStaged
    ? ['diff', '--name-status', '--cached']
    : ['diff', '--name-status', ref];

  const [numstatResult, nameStatusResult] = await Promise.all([
    ctx.exec(GIT_EXECUTABLE, diffArgs).catch(() => ({ stdout: '' })),
    ctx.exec(GIT_EXECUTABLE, nameArgs).catch(() => ({ stdout: '' })),
  ]);

  const numstatMap = parseNumstat(numstatResult.stdout);

  const changes: GitChange[] = [];
  for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    const filePath = (parts[parts.length - 1] ?? '').trim();
    if (!filePath) continue;

    const stat = numstatMap.get(filePath);
    changes.push({
      path: filePath,
      status: mapStatus(code),
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    });
  }

  return changes;
}

export async function getCommitFiles(
  ctx: IExecutionContext,
  commitHash: string
): Promise<CommitFile[]> {
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '-r',
    '-m',
    '--first-parent',
    '--numstat',
    commitHash,
  ]);

  const { stdout: nameStatus } = await ctx.exec(GIT_EXECUTABLE, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '-r',
    '-m',
    '--first-parent',
    '--name-status',
    commitHash,
  ]);

  const statLines = stdout.trim().split('\n').filter(Boolean);
  const statusLines = nameStatus.trim().split('\n').filter(Boolean);

  const statusMap = new Map<string, string>();
  for (const line of statusLines) {
    const [code, ...pathParts] = line.split('\t');
    const filePath = pathParts[pathParts.length - 1] || '';
    statusMap.set(filePath, mapStatus(code ?? ''));
  }

  return statLines.map((line) => {
    const [addStr, delStr, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    return {
      path: filePath,
      status: statusMap.get(filePath) || 'modified',
      additions: addStr === '-' ? 0 : Number.parseInt(addStr || '0', 10) || 0,
      deletions: delStr === '-' ? 0 : Number.parseInt(delStr || '0', 10) || 0,
    };
  });
}
