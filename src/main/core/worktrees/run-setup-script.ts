import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Where a checkout's setup log lives: inside its own git directory
 * (`<main>/.git/worktrees/<name>/` for a linked worktree). Never tracked,
 * never in the user's working tree, and removed with the checkout.
 */
export async function laneSetupLogPath(checkoutPath: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: checkoutPath }).exec(GIT_EXECUTABLE, [
    'rev-parse',
    '--absolute-git-dir',
  ]);
  return `${stdout.trim()}/chord-setup.log`;
}

/**
 * Runs `script` non-interactively in the platform shell (`/bin/sh`, or
 * `cmd.exe` on Windows — the same shell `npm run` uses), appending stdout and
 * stderr to `logPath`. Resolves with the exit code; a script killed by a
 * signal resolves with `exitCode: null`.
 */
export function runSetupScript(args: {
  cwd: string;
  script: string;
  env: Record<string, string>;
  logPath: string;
}): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(args.logPath, { flags: 'a' });
    const child = spawn(args.script, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('error', (error) => {
      log.end(() => reject(error));
    });
    child.once('close', (exitCode, signal) => {
      log.end(() => resolve({ exitCode, signal }));
    });
  });
}
