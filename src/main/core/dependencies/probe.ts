import type { IExecutionContext } from '@main/core/execution-context/types';
import { findCommandOnPath } from './path-lookup';
import type { ProbeResult } from './types';

const WHICH_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 10_000;

/**
 * Resolves the absolute path of a command binary, or `null` if it is not found.
 *
 * A local context reads PATH in this process (`findCommandOnPath`): spawning
 * `where` for each dependency blocked the main thread at boot. A remote (SSH)
 * context is a POSIX target whatever the host is, so it asks `which` there.
 */
export async function resolveCommandPath(
  command: string,
  ctx: IExecutionContext
): Promise<string | null> {
  if (ctx.supportsLocalSpawn) {
    return findCommandOnPath(command, {
      path: process.env.PATH,
      pathExt: process.env.PATHEXT,
      platform: process.platform,
    });
  }
  let stdout: string;
  try {
    ({ stdout } = await ctx.exec('which', [command], { timeout: WHICH_TIMEOUT_MS }));
  } catch {
    // `which` exits non-zero when the command is not on PATH.
    return null;
  }
  return (
    stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

/**
 * Runs `command args` and collects stdout/stderr up to a timeout.
 * Never throws — all failures are captured in the returned `ProbeResult`.
 * `env` is layered over the inherited environment, e.g. to keep a CLI's
 * self-updater from running when only its version is read.
 */
export async function runVersionProbe(
  command: string,
  resolvedPath: string | null,
  args: string[],
  ctx: IExecutionContext,
  {
    env,
    timeoutMs = VERSION_PROBE_TIMEOUT_MS,
  }: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<ProbeResult> {
  const bin = resolvedPath ?? command;
  try {
    const { stdout, stderr } = await ctx.exec(bin, args, { timeout: timeoutMs, env });
    return { command, path: resolvedPath, stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return {
      command,
      path: resolvedPath,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? null,
      timedOut: !!e.killed,
    };
  }
}
