import type {
  CommitError,
  FetchError,
  GitHeadState,
  PullError,
  PushError,
  SoftResetError,
} from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { MAX_REF_LIST_BYTES } from './git-utils';
import { planPullRequestPush } from './pull-request-push';
import { classifyPushFailure } from './push-failure';

export async function commit(
  ctx: IExecutionContext,
  message: string
): Promise<Result<{ hash: string }, CommitError>> {
  if (!message || !message.trim()) return err({ type: 'empty_message' });
  try {
    await ctx.exec(GIT_EXECUTABLE, ['commit', '-m', message]);
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || '';
    const stdout = (error as { stdout?: string })?.stdout || '';
    const output = stderr || stdout || String(error);
    if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
      return err({ type: 'nothing_to_commit' });
    }
    return err({ type: 'hook_failed', message: output });
  }
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['rev-parse', 'HEAD']);
    return ok({ hash: stdout.trim() });
  } catch (error: unknown) {
    return err({ type: 'error', message: String(error) });
  }
}

export async function fetch(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  remote?: string
): Promise<Result<void, FetchError>> {
  try {
    const remotes = await ctx.exec(GIT_EXECUTABLE, ['remote']).catch(() => ({
      stdout: '',
    }));
    const remoteNames = remotes.stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
    if (remoteNames.length === 0) return err({ type: 'no_remote' });

    const selectedRemote = remote?.trim();
    if (selectedRemote && !remoteNames.includes(selectedRemote)) {
      return err({ type: 'remote_not_found', message: `Remote "${selectedRemote}" not found` });
    }

    await authCtx.exec(GIT_EXECUTABLE, selectedRemote ? ['fetch', selectedRemote] : ['fetch'], {
      maxBuffer: MAX_REF_LIST_BYTES,
    });
    return ok();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || String(error);
    if (
      stderr.includes('Authentication failed') ||
      stderr.includes('authentication failed') ||
      stderr.includes('Permission denied') ||
      stderr.includes('could not read Username')
    ) {
      return err({ type: 'auth_failed', message: stderr });
    }
    if (
      stderr.includes('Could not resolve host') ||
      stderr.includes('could not resolve host') ||
      stderr.includes('Network is unreachable') ||
      stderr.includes('Connection refused') ||
      stderr.includes('Connection timed out') ||
      stderr.includes('unable to connect')
    ) {
      return err({ type: 'network_error', message: stderr });
    }
    if (
      stderr.includes('does not appear to be a git repository') ||
      stderr.includes('repository not found') ||
      stderr.includes('Repository not found') ||
      stderr.includes('not found') ||
      stderr.includes('ERROR: Repository not found')
    ) {
      return err({ type: 'remote_not_found', message: stderr });
    }
    return err({ type: 'error', message: stderr });
  }
}

export async function push(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  preferredRemote?: string
): Promise<Result<{ output: string }, PushError>> {
  const doPush = async (args: string[]): Promise<string> => {
    const { stdout, stderr } = await authCtx.exec(GIT_EXECUTABLE, args);
    return (stdout || stderr || '').trim();
  };

  const { stdout: currentOut } = await ctx.exec(GIT_EXECUTABLE, ['branch', '--show-current']);
  const current = currentOut.trim();
  const plan = current ? await planPullRequestPush(ctx, current) : ({ kind: 'default' } as const);
  if (plan.kind === 'refused') return err({ type: 'fork_push_refused', message: plan.message });

  try {
    const output = await doPush(
      plan.kind === 'explicit' ? ['push', plan.remote, plan.refspec] : ['push']
    );
    return ok({ output });
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || '';
    const message = stderr || String(error);

    if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
      return ok({ output: 'Everything up-to-date' });
    }

    if (
      plan.kind === 'default' &&
      (stderr.includes('has no upstream branch') ||
        stderr.includes('no upstream configured') ||
        stderr.includes('upstream branch of your current branch does not match'))
    ) {
      try {
        const currentBranch = current;
        let pushRemote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
        try {
          const { stdout: remoteOut } = await ctx.exec(GIT_EXECUTABLE, [
            'config',
            '--get',
            `branch.${currentBranch}.remote`,
          ]);
          if (remoteOut.trim()) pushRemote = remoteOut.trim();
        } catch {}
        const output = await doPush(['push', '--set-upstream', pushRemote, currentBranch]);
        return ok({ output });
      } catch (upstreamError: unknown) {
        const upstreamStderr = (upstreamError as { stderr?: string })?.stderr || '';
        return err({ type: 'error', message: upstreamStderr || String(upstreamError) });
      }
    }

    return err(classifyPushFailure(stderr, message));
  }
}

export async function publishBranch(
  ctx: IExecutionContext,
  authCtx: IExecutionContext,
  branchName: string,
  remote = 'origin'
): Promise<Result<{ output: string }, PushError>> {
  const doPush = async (args: string[]): Promise<string> => {
    const { stdout, stderr } = await authCtx.exec(GIT_EXECUTABLE, args);
    return (stdout || stderr || '').trim();
  };

  const plan = await planPullRequestPush(ctx, branchName);
  if (plan.kind === 'refused') return err({ type: 'fork_push_refused', message: plan.message });

  try {
    const output = await doPush(
      plan.kind === 'explicit'
        ? ['push', plan.remote, plan.refspec]
        : ['push', '--set-upstream', remote, branchName]
    );
    return ok({ output });
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string })?.stderr || '';
    const message = stderr || String(error);

    if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
      return ok({ output: 'Everything up-to-date' });
    }

    if (
      stderr.includes('[rejected]') ||
      stderr.includes('Updates were rejected') ||
      stderr.includes('non-fast-forward')
    ) {
      try {
        await ctx.exec(GIT_EXECUTABLE, [
          'branch',
          `--set-upstream-to=${remote}/${branchName}`,
          branchName,
        ]);
      } catch {}
      return err({ type: 'rejected', message });
    }

    if (stderr.includes('does not appear to be a git repository')) {
      return err({ type: 'no_remote', message });
    }

    return err(classifyPushFailure(stderr, message));
  }
}

export async function pull(
  authCtx: IExecutionContext,
  ctx: IExecutionContext
): Promise<Result<{ output: string }, PullError>> {
  try {
    const { stdout } = await authCtx.exec(GIT_EXECUTABLE, ['pull']);
    return ok({ output: stdout.trim() });
  } catch (error: unknown) {
    const stdout = (error as { stdout?: string })?.stdout || '';
    const stderr = (error as { stderr?: string })?.stderr || '';
    const message = stderr || String(error);

    if (stdout.includes('CONFLICT') || stderr.includes('CONFLICT')) {
      let conflictedFiles: string[] = [];
      try {
        const { stdout: conflictOut } = await ctx.exec(GIT_EXECUTABLE, [
          'diff',
          '--name-only',
          '--diff-filter=U',
        ]);
        conflictedFiles = conflictOut
          .split('\n')
          .map((f) => f.trim())
          .filter(Boolean);
      } catch {}
      return err({ type: 'conflict', conflictedFiles, message });
    }

    if (
      stderr.includes('There is no tracking information') ||
      stderr.includes('no tracking information') ||
      stderr.includes('has no upstream branch') ||
      stderr.includes('no upstream configured')
    ) {
      return err({ type: 'no_upstream', message });
    }

    if (
      stderr.includes('Need to specify how to reconcile') ||
      stderr.includes('hint: You have divergent branches') ||
      stderr.includes('fatal: Need to specify how to reconcile')
    ) {
      return err({ type: 'diverged', message });
    }

    if (
      stderr.includes('Authentication failed') ||
      stderr.includes('authentication failed') ||
      stderr.includes('Permission denied') ||
      stderr.includes('could not read Username')
    ) {
      return err({ type: 'auth_failed', message });
    }

    if (
      stderr.includes('Could not resolve host') ||
      stderr.includes('could not resolve host') ||
      stderr.includes('Network is unreachable') ||
      stderr.includes('Connection refused') ||
      stderr.includes('Connection timed out') ||
      stderr.includes('unable to connect')
    ) {
      return err({ type: 'network_error', message });
    }

    return err({ type: 'error', message });
  }
}

export async function softReset(
  ctx: IExecutionContext,
  getLog: (opts?: {
    maxCount?: number;
  }) => Promise<{ commits: { isPushed: boolean }[]; aheadCount: number }>
): Promise<Result<{ subject: string; body: string }, SoftResetError>> {
  try {
    await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD~1']);
  } catch {
    return err({ type: 'initial_commit' });
  }

  const { commits: log } = await getLog({ maxCount: 1 });
  if (log[0]?.isPushed) {
    return err({ type: 'already_pushed' });
  }

  try {
    const { stdout: subject } = await ctx.exec(GIT_EXECUTABLE, ['log', '-1', '--pretty=format:%s']);
    const { stdout: body } = await ctx.exec(GIT_EXECUTABLE, ['log', '-1', '--pretty=format:%b']);

    await ctx.exec(GIT_EXECUTABLE, ['reset', '--soft', 'HEAD~1']);

    return ok({ subject: subject.trim(), body: body.trim() });
  } catch (error: unknown) {
    return err({ type: 'error', message: String(error) });
  }
}

export async function getRemotes(ctx: IExecutionContext): Promise<{ name: string; url: string }[]> {
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, ['remote', '-v']);
    const seen = new Set<string>();
    const remotes: { name: string; url: string }[] = [];
    for (const line of stdout.split('\n')) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
      if (match?.[1] && match[2] && !seen.has(match[1])) {
        seen.add(match[1]);
        remotes.push({ name: match[1], url: match[2] });
      }
    }
    return remotes;
  } catch {
    return [];
  }
}

export async function getHeadState(ctx: IExecutionContext): Promise<GitHeadState> {
  let headName: string | undefined;
  try {
    const { stdout } = await ctx.exec(GIT_EXECUTABLE, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ]);
    headName = stdout.trim() || undefined;
  } catch {}

  try {
    await ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD']);
    return { headName, isUnborn: false };
  } catch {
    return { headName, isUnborn: true };
  }
}

export async function addRemote(ctx: IExecutionContext, name: string, url: string): Promise<void> {
  await ctx.exec(GIT_EXECUTABLE, ['remote', 'add', name, url]);
}
