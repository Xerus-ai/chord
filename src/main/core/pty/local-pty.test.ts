import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnLocalPty, type LocalPtySession } from './local-pty';
import type { PtyExitInfo } from './pty';

/**
 * A terminal's exit means its processes are gone (devstation-lvp). Lane Delete
 * waits for a stopped session's exit and then removes the checkout
 * (`stop-checkout-sessions.ts`); on Windows a folder a live process sits in
 * can't be removed. node-pty's ConPTY `kill()` reports exit when its socket
 * closes, before the console's processes are killed (that runs later, through
 * a forked helper with a 5s timeout), and a process the terminal started
 * detached is not in the console at all — an agent's dev server, say.
 *
 * Real PTY, real processes: the terminal runs node, which starts a detached
 * node that keeps a file open in the folder.
 */

const dirs: string[] = [];
const strays: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-local-pty-')));
  dirs.push(dir);
  return dir;
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function exitOf(pty: LocalPtySession): Promise<PtyExitInfo> {
  return new Promise((resolve) => pty.onExit(resolve));
}

afterEach(async () => {
  for (const pid of strays.splice(0)) {
    if (!isAlive(pid)) continue;
    process.kill(pid);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 5_000 });
  }
  // rmSync's maxRetries does not retry EPERM (Node 24), so a folder a process
  // just let go of is retried here.
  for (const dir of dirs.splice(0)) {
    await vi.waitFor(() => rmSync(dir, { recursive: true, force: true }), { timeout: 10_000 });
  }
});

describe('LocalPtySession', () => {
  it.runIf(process.platform === 'win32')(
    "reports exit after kill only once the terminal's processes, detached ones included, are gone",
    async () => {
      const dir = makeDir();
      const script = join(dir, 'terminal.cjs');
      writeFileSync(
        script,
        [
          "const { spawn } = require('node:child_process');",
          "const { writeFileSync } = require('node:fs');",
          'const child = spawn(process.execPath, [',
          "  '-e',",
          "  \"require('node:fs').openSync('held.txt', 'w'); setInterval(() => {}, 1000);\",",
          "], { cwd: __dirname, detached: true, stdio: 'ignore' });",
          "writeFileSync(require('node:path').join(__dirname, 'child.pid'), String(child.pid));",
          'setInterval(() => {}, 1000);',
        ].join('\n')
      );
      const pty = spawnLocalPty({
        id: 'pty-tree',
        command: process.execPath,
        args: [script],
        cwd: dir,
        env: processEnv(),
        cols: 80,
        rows: 24,
      });
      const exited = exitOf(pty);
      const pidFile = join(dir, 'child.pid');
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
      const childPid = Number(readFileSync(pidFile, 'utf8'));
      strays.push(childPid);
      await vi.waitFor(() => expect(existsSync(join(dir, 'held.txt'))).toBe(true), {
        timeout: 10_000,
      });

      pty.kill();
      await exited;

      expect(pty.killedBy()).toBe('tree');
      expect(isAlive(childPid)).toBe(false);
      expect(() => rmSync(dir, { recursive: true })).not.toThrow();
    },
    30_000
  );

  /**
   * devstation-v1x2: node-pty reports a ConPTY exit only after the output has been quiet for 1s
   * (longer, or never, while something keeps writing), but knows the shell's own exit at once.
   * A kill in between must not taskkill the shell's pid: Windows may already have given it to
   * another process, and /T would end that process's tree. It closes the console instead.
   */
  function spawnExitingShell(id: string): LocalPtySession {
    return spawnLocalPty({
      id,
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd: makeDir(),
      env: processEnv(),
      cols: 80,
      rows: 24,
    });
  }

  it.runIf(process.platform === 'win32')(
    "knows the shell exited before node-pty's exit event",
    async () => {
      const pty = spawnExitingShell('pty-exited-shell');
      let reported = false;
      const exited = new Promise<void>((resolve) =>
        pty.onExit(() => {
          reported = true;
          resolve();
        })
      );
      expect(pty.hasShellExited()).toBe(false);
      await vi.waitFor(() => expect(pty.hasShellExited()).toBe(true), {
        timeout: 10_000,
        interval: 20,
      });
      expect(reported).toBe(false);
      await exited;
    },
    30_000
  );

  it.runIf(process.platform === 'win32')(
    "a kill between the shell's exit and the exit event reports the exit",
    async () => {
      const pty = spawnExitingShell('pty-kill-after-exit');
      const exited = exitOf(pty);
      await vi.waitFor(() => expect(pty.hasShellExited()).toBe(true), {
        timeout: 10_000,
        interval: 20,
      });

      pty.kill();

      // The shell's pid is never handed to taskkill once the shell has exited.
      expect(pty.killedBy()).toBe('console');
      expect((await exited).exitCode).toBe(0);
    },
    30_000
  );

  it.runIf(process.platform === 'win32')(
    'a kill after the exit was reported ends nothing: no tree kill, no console close',
    async () => {
      const pty = spawnExitingShell('pty-kill-after-report');
      await exitOf(pty);

      pty.kill();

      expect(pty.killedBy()).toBe(null);
    },
    30_000
  );

  it('reports the exit code of a process that ends on its own', async () => {
    const pty = spawnLocalPty({
      id: 'pty-natural',
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
      cwd: makeDir(),
      env: processEnv(),
      cols: 80,
      rows: 24,
    });

    expect((await exitOf(pty)).exitCode).toBe(3);
  });
});
