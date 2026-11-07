import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * A process the run engine's suites started, as they check it later: its pid
 * and when it started. A pid alone may name another process by then: Windows
 * gives a gone process's pid to a new one, and a Solo release starts the next
 * lane's terminal (conhost, cmd, node) right after it stops the holder's. A
 * point-in-time `process.kill(pid, 0)` read that new process as the stopped
 * run still alive (devstation-4x42.203: a conhost.exe created after the run's
 * mark held its pid in every such case reproduced).
 */
export interface RunProcess {
  pid: number;
  startedAt: string;
}

/** When the process now running as `pid` started; null when none runs as it. */
async function readStartTime(pid: number): Promise<string | null> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // No such process is an answer, not a failure: PowerShell would exit 1 for it.
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().Ticks }; exit 0`,
    ]);
    return stdout.trim() || null;
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)]);
    return stdout.trim() || null;
  } catch (error) {
    // ps exits 1 when no process has the pid.
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

/** The process running as `pid` now; throws when none is. Read it while the process is known to run. */
export async function runProcessOf(pid: number): Promise<RunProcess> {
  const startedAt = await readStartTime(pid);
  if (startedAt === null) throw new Error(`no process runs as pid ${pid}`);
  return { pid, startedAt };
}

/** Whether that process, not merely a process with its pid, is still running. */
export async function isRunning(proc: RunProcess): Promise<boolean> {
  return (await readStartTime(proc.pid)) === proc.startedAt;
}
