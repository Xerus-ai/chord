import type { FetchPrForReviewError, GitInfo } from '@shared/git';
import { parseGitHubRepository } from '@shared/github-repository';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { computeBaseRef } from './git-utils';

export async function fetchPrForReview(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  prNumber: number,
  headRefName: string,
  headRepositoryUrl: string,
  localBranch: string,
  isFork: boolean,
  configuredRemote = 'origin'
): Promise<Result<void, FetchPrForReviewError>> {
  try {
    if (isFork) {
      const forkRemote = parseGitHubRepository(headRepositoryUrl)?.owner ?? 'fork';
      const remotes = await ctx.exec(GIT_EXECUTABLE, ['remote']).catch(() => ({ stdout: '' }));
      const names = remotes.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!names.includes(forkRemote)) {
        await ctx.exec(GIT_EXECUTABLE, ['remote', 'add', forkRemote, headRepositoryUrl]);
      } else {
        await ctx
          .exec(GIT_EXECUTABLE, ['remote', 'set-url', forkRemote, headRepositoryUrl])
          .catch(() => {});
      }
      await authCtx.exec(GIT_EXECUTABLE, [
        'fetch',
        forkRemote,
        `${headRefName}:refs/heads/${localBranch}`,
        '--force',
      ]);
      await ctx
        .exec(GIT_EXECUTABLE, [
          'branch',
          `--set-upstream-to=${forkRemote}/${headRefName}`,
          localBranch,
        ])
        .catch(() => {});
    } else {
      await authCtx.exec(GIT_EXECUTABLE, [
        'fetch',
        configuredRemote,
        `refs/pull/${prNumber}/head:refs/heads/${localBranch}`,
        '--force',
      ]);
      await ctx
        .exec(GIT_EXECUTABLE, [
          'branch',
          `--set-upstream-to=${configuredRemote}/${headRefName}`,
          localBranch,
        ])
        .catch(() => {});
    }
    return ok();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    if (
      stderr.includes('not found') ||
      stderr.includes("couldn't find remote ref") ||
      stderr.includes('unknown revision')
    ) {
      return err({ type: 'not_found', prNumber });
    }
    return err({ type: 'error', message: stderr });
  }
}

export async function detectInfo(
  ctx: IExecutionContext,
  authCtx: IExecutionContext
): Promise<GitInfo> {
  try {
    await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { isGitRepo: false, baseRef: 'main', rootPath: ctx.root ?? '' };
  }

  let remoteName: string | undefined;
  let remote: string | undefined;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['remote']);
    const remotes = stdout.trim().split('\n').filter(Boolean);
    remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
  } catch {}

  if (remoteName) {
    try {
      const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['remote', 'get-url', remoteName]);
      remote = stdout.trim() || undefined;
    } catch {}
  }

  let branch: string | undefined;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['branch', '--show-current']);
    branch = stdout.trim() || undefined;
  } catch {}

  if (!branch && remoteName) {
    try {
      const { stdout } = await authCtx.exec(GIT_EXECUTABLE, ['remote', 'show', remoteName]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      branch = match?.[1] ?? undefined;
    } catch {}
  }

  let rootPath: string = ctx.root ?? '';
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--show-toplevel']);
    const trimmed = stdout.trim();
    if (trimmed) rootPath = trimmed;
  } catch {}

  return {
    isGitRepo: true,
    remote,
    branch,
    baseRef: computeBaseRef(undefined, remoteName, branch),
    rootPath,
  };
}

export async function initRepository(ctx: IExecutionContext): Promise<void> {
  await ctx.exec(GIT_EXECUTABLE, ['init']);
}
