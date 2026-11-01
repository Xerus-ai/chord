import { existsSync } from 'node:fs';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

export interface GitWorktreeEntry {
  /** Native, resolved path. */
  path: string;
  head: string | null;
  /** Null when detached. */
  branch: string | null;
  /** The first entry git lists: the repository's main checkout. */
  isMain: boolean;
  bare: boolean;
  /** Registered with git, but its folder is gone (git calls it prunable). */
  missing: boolean;
}

const BRANCH_PREFIX = 'branch refs/heads/';

/** `git worktree list --porcelain`, run in `repoPath`. */
export async function readGitWorktreeList(repoPath: string): Promise<GitWorktreeEntry[]> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['worktree', 'list', '--porcelain']);
  return stdout
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines, index) => {
      // Git prints forward slashes even on Windows.
      const folder = path.resolve(lines[0].slice('worktree '.length));
      const head = lines.find((line) => line.startsWith('HEAD '));
      const branch = lines.find((line) => line.startsWith(BRANCH_PREFIX));
      return {
        path: folder,
        head: head ? head.slice('HEAD '.length) : null,
        branch: branch ? branch.slice(BRANCH_PREFIX.length) : null,
        isMain: index === 0,
        bare: lines.includes('bare'),
        missing: lines.some((line) => line.startsWith('prunable')) || !existsSync(folder),
      };
    });
}
