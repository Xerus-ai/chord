import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import type { ndJsonStream } from '@agentclientprotocol/sdk';
import { withTimeout } from '@shared/result';
import { log } from '@main/lib/logger';

/** How long an agent told to stop (stdin closed, then killed) may take to be gone, each time. */
const ACP_EXIT_TIMEOUT_MS = 5_000;

/** The ACP SDK, loaded on first use so it stays out of the startup module graph. */
const loadAcpSdk = () => import('@agentclientprotocol/sdk');

/**
 * An ACP agent's process and its newline-JSON stream. Windows runs the agent
 * through a shell so `.cmd` shims resolve; a command path with spaces is quoted.
 *
 * `closed` settles once every process holding the agent's stdio has exited:
 * under the Windows shell that is the agent itself, not only the shell, whose
 * own `exit` comes first. It is listened for from the spawn on, so a close
 * that already happened is not missed.
 */
export interface AcpProcess {
  child: ChildProcess;
  stream: ReturnType<typeof ndJsonStream>;
  closed: Promise<void>;
}

export async function spawnAcpProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}): Promise<AcpProcess> {
  const { ndJsonStream } = await loadAcpSdk();
  const command =
    process.platform === 'win32' && opts.command.includes(' ') ? `"${opts.command}"` : opts.command;
  const child = spawn(command, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const readable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
  return { child, stream: ndJsonStream(writable, readable), closed };
}

/**
 * Ends the agent and, on Windows, the shell tree it runs under. A child Node has already seen
 * exit is left alone (devstation-l9k5): Node no longer holds its process handle, so Windows may
 * have given its pid to another process, and `taskkill /T` would end that process's tree.
 */
export function killAcpProcess(child: ChildProcess): 'tree' | 'signal' | 'exited' {
  if (child.exitCode !== null || child.signalCode !== null) return 'exited';
  if (child.pid && process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' }).on(
      'error',
      (error) => log.warn('acp: taskkill failed', { pid: child.pid, error: error.message })
    );
    return 'tree';
  }
  child.kill('SIGTERM');
  return 'signal';
}

/**
 * Stops a short-lived agent and resolves once it is gone. On Windows a folder
 * a live process sits in can't be removed, so a lane Delete right after a
 * listing hit EPERM.
 *
 * Closing stdin comes first: the agent then shuts down itself and what it
 * started in the lane (opencode runs processes in the listed folder that don't
 * hold its stdio, so a killed agent's `closed` came before they were gone —
 * measured, probe-arx7 `stop-source`). Only an agent that ignores it is
 * killed. Throws when it is still running after that too.
 */
export async function stopAcpProcess(child: ChildProcess, closed: Promise<void>): Promise<void> {
  child.stdin?.end();
  try {
    await withTimeout(closed, ACP_EXIT_TIMEOUT_MS);
    return;
  } catch {
    log.warn('acp: agent did not exit when its input closed; killing it', { pid: child.pid });
  }
  killAcpProcess(child);
  try {
    await withTimeout(closed, ACP_EXIT_TIMEOUT_MS);
  } catch {
    throw new Error(
      `The agent (pid ${child.pid}) was still running ${ACP_EXIT_TIMEOUT_MS / 1000}s after it was killed`
    );
  }
}
