import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isRunning, runProcessOf, type RunProcess } from './_testing/run-process';

/**
 * The run engine's suites check a stopped run by its process, not its pid
 * (devstation-4x42.203): Windows gave a stopped run's pid to a new conhost.exe
 * within the moment between Stop and the check, and `process.kill(pid, 0)`
 * read the run as alive. Real processes.
 */
describe('RunProcess', () => {
  it('is running until its process exits, and a pid now naming another start is not it', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const pid = child.pid;
    if (pid === undefined) throw new Error('the child did not start');
    let run: RunProcess;
    try {
      run = await runProcessOf(pid);

      expect(await isRunning(run)).toBe(true);
      // What a reused pid looks like: the same pid, another process's start.
      expect(await isRunning({ pid, startedAt: `${run.startedAt}0` })).toBe(false);
    } finally {
      child.kill();
      await exited;
    }
    expect(await isRunning(run)).toBe(false);
    await expect(runProcessOf(pid)).rejects.toThrow(`no process runs as pid ${pid}`);
  }, 30_000);
});
