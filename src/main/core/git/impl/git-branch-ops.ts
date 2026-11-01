import path from 'node:path';
import type {
  Branch,
  CreateBranchError,
  DeleteBranchError,
  LocalBranch,
  RemoteBranch,
  RenameBranchError,
} from '@shared/git';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { MAX_REF_LIST_BYTES } from './git-utils';

export async function getCurrentBranch(ctx: IExecutionContext): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'rev-parse',
      '--symbolic-full-name',
      'HEAD',
    ]);
    const ref = stdout.trim();
    if (ref === 'HEAD' || !ref) return null;
    if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
    if (ref.startsWith('heads/')) return ref.slice('heads/'.length);
    return ref;
  } catch {
    return null;
  }
}

export async function getWorktreeGitDir(
  ctx: IExecutionContext,
  mainDotGitAbs: string
): Promise<string> {
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--git-dir']);
    const raw = stdout.trim();
    const root = ctx.root ?? '';
    const gitDirAbs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
    const rel = path.relative(mainDotGitAbs, gitDirAbs).replace(/\\/g, '/');
    return rel === '.' || rel === '' ? '' : rel;
  } catch {
    return `worktrees/${path.basename(ctx.root ?? '')}`;
  }
}

export async function getBranches(
  ctx: IExecutionContext,
  getRemotes: () => Promise<{ name: string; url: string }[]>
): Promise<Branch[]> {
  const remotes = await getRemotes();
  const remoteByName = new Map(remotes.map((remote) => [remote.name, remote]));
  const { stdout } = await ctx.exec(
    GIT_EXECUTABLE,
    ['branch', '-a', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)'],
    { maxBuffer: MAX_REF_LIST_BYTES }
  );

  const branches: Branch[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [refname, upstreamRef, track, fullRef] = trimmed.split('|');

    if (fullRef?.startsWith('refs/remotes/')) {
      const withoutPrefix = fullRef.slice('refs/remotes/'.length);
      if (withoutPrefix.includes('HEAD')) continue;
      const slashIdx = withoutPrefix.indexOf('/');
      const remoteName = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
      const branchName = slashIdx === -1 ? '' : withoutPrefix.slice(slashIdx + 1);
      const entry: RemoteBranch = {
        type: 'remote',
        branch: branchName,
        remote: remoteByName.get(remoteName) ?? { name: remoteName, url: '' },
      };
      branches.push(entry);
    } else {
      const localBranchName = fullRef?.startsWith('refs/heads/')
        ? fullRef.slice('refs/heads/'.length)
        : refname;
      const entry: LocalBranch = { type: 'local', branch: localBranchName };
      if (upstreamRef) {
        const slashIdx = upstreamRef.indexOf('/');
        const remoteName = slashIdx === -1 ? upstreamRef : upstreamRef.slice(0, slashIdx);
        entry.remote = remoteByName.get(remoteName) ?? { name: remoteName, url: '' };
        if (track) {
          const ahead = Number.parseInt(/ahead (\d+)/.exec(track)?.[1] ?? '0', 10);
          const behind = Number.parseInt(/behind (\d+)/.exec(track)?.[1] ?? '0', 10);
          entry.divergence = { ahead, behind };
        }
      }
      branches.push(entry);
    }
  }

  return branches;
}

export async function getDefaultBranch(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  remote = 'origin'
): Promise<string> {
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'symbolic-ref',
      `refs/remotes/${remote}/HEAD`,
      '--short',
    ]);
    const ref = stdout.trim();
    if (ref) {
      const slashIdx = ref.indexOf('/');
      return slashIdx === -1 ? ref : ref.slice(slashIdx + 1);
    }
  } catch {}

  try {
    const { stdout } = await authCtx.exec(GIT_EXECUTABLE, ['remote', 'show', remote]);
    const match = /HEAD branch:\s*(\S+)/.exec(stdout);
    if (match?.[1]) return match[1];
  } catch {}

  for (const candidate of ['main', 'master', 'develop', 'trunk']) {
    if (await branchExistsLocally(ctx, candidate)) return candidate;
  }

  return 'main';
}

async function branchExistsLocally(ctx: IExecutionContext, branch: string): Promise<boolean> {
  try {
    await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function createBranch(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  name: string,
  from: string,
  syncWithRemote = true,
  remote = 'origin'
): Promise<Result<void, CreateBranchError>> {
  if (syncWithRemote) {
    await authCtx
      .exec(GIT_EXECUTABLE, ['fetch', remote], {
        maxBuffer: MAX_REF_LIST_BYTES,
      })
      .catch(() => {});
  }
  const base = syncWithRemote ? `${remote}/${from}` : `refs/heads/${from}`;
  try {
    await ctx.exec(GIT_EXECUTABLE, ['branch', '--no-track', name, base]);
    return ok();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || String(error);
    if (stderr.includes('already exists')) {
      return err({ type: 'already_exists', name });
    }
    if (
      stderr.includes('not a valid object name') ||
      stderr.includes('Not a valid object name') ||
      stderr.includes('invalid reference')
    ) {
      return err({ type: 'invalid_base', from });
    }
    if (
      stderr.includes('not a valid branch name') ||
      stderr.includes('invalid branch name') ||
      stderr.includes("'.' is not a valid branch name")
    ) {
      return err({ type: 'invalid_name', name });
    }
    return err({ type: 'error', message: stderr });
  }
}

export async function renameBranch(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  oldBranch: string,
  newBranch: string
): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
  let remoteName: string | undefined;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'config',
      '--get',
      `branch.${oldBranch}.remote`,
    ]);
    remoteName = stdout.trim() || undefined;
  } catch {}

  try {
    await ctx.exec(GIT_EXECUTABLE, ['branch', '-m', oldBranch, newBranch]);
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || String(error);
    if (stderr.includes('already exists')) {
      return err({ type: 'already_exists', name: newBranch });
    }
    return err({ type: 'error', message: stderr });
  }

  if (remoteName) {
    try {
      await authCtx.exec(GIT_EXECUTABLE, ['push', remoteName, '--delete', oldBranch]);
    } catch {}
    try {
      await authCtx.exec(GIT_EXECUTABLE, ['push', '-u', remoteName, newBranch]);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      return err({ type: 'remote_push_failed', message: stderr });
    }
  }

  return ok({ remotePushed: !!remoteName });
}

export async function deleteBranch(
  ctx: IExecutionContext,
  branch: string,
  force = true
): Promise<Result<void, DeleteBranchError>> {
  const flag = force ? '-D' : '-d';
  try {
    await ctx.exec(GIT_EXECUTABLE, ['branch', flag, branch]);
    return ok();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || String(error);
    if (stderr.includes('not fully merged')) {
      return err({ type: 'unmerged', branch });
    }
    if (stderr.includes('not found') || stderr.includes('did not match any branch')) {
      return err({ type: 'not_found', branch });
    }
    if (stderr.includes('checked out') || stderr.includes('is not fully merged')) {
      return err({ type: 'is_current', branch });
    }
    return err({ type: 'error', message: stderr });
  }
}
