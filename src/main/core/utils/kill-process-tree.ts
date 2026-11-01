import { execFile } from 'node:child_process';

/** How long a killed tree may take to be gone before that is an error. */
const TREE_EXIT_TIMEOUT_MS = 5_000;
const POLL_MS = 50;
/** taskkill's exit code when the process is already gone. */
const TASKKILL_NOT_FOUND = 128;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `not-found`: the root was already gone, so there was no tree to walk. */
export type TreeKillOutcome = 'ended' | 'not-found';

function runTaskkill(pid: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/F', '/T', '/PID', String(pid)], (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if (error.code === TASKKILL_NOT_FOUND) return resolve(null);
      reject(new Error(`taskkill /T of pid ${pid} failed: ${stderr.trim() || error.message}`));
    });
  });
}

/**
 * Ends a process this process started, and every process under it, on
 * Windows; resolves once all of them are gone. Throws when one is still
 * running after the timeout.
 *
 * A process's exit is not its tree's: a folder a child still sits in can't be
 * removed, and a child started detached is in no console a terminal closes.
 * `taskkill /T` walks the tree by parent while the root is still there and
 * prints one line per process it ended, naming that process and its parent.
 * Every pid it prints is in the tree except the root's parent — this process —
 * so those are the pids waited for.
 *
 * Call it only for a root known to be alive (devstation-v1x2): once a process
 * has exited, Windows may give its pid to another process, and /T would end
 * that one's tree.
 */
export async function killProcessTree(pid: number): Promise<TreeKillOutcome> {
  const output = await runTaskkill(pid);
  if (output === null) return 'not-found';
  const pids = new Set(
    [...output.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((n) => n !== process.pid)
  );
  pids.add(pid);
  const deadline = Date.now() + TREE_EXIT_TIMEOUT_MS;
  for (;;) {
    const running = [...pids].filter(isRunning);
    if (running.length === 0) return 'ended';
    if (Date.now() > deadline) {
      throw new Error(
        `Processes ${running.join(', ')} of pid ${pid}'s tree were still running ${TREE_EXIT_TIMEOUT_MS / 1000}s after taskkill`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
