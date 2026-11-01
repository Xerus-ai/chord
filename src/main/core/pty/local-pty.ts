import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { killProcessTree } from '@main/core/utils/kill-process-tree';
import { log } from '@main/lib/logger';
import { closeConptyConsole, hasConptyShellExited } from './conpty-internals';
import { normalizeSignal } from './exit-signals';
import { planAfterTreeKill, planKill, type KillState, type TreeKillResult } from './kill-plan';
import { suppressExpectedNodePtyErrors } from './node-pty-errors';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';

export interface LocalSpawnOptions extends PtyDimensions {
  id: string;
  command: string;
  /** argv, or one pre-built Windows command line (`ResolvedLocalPtySpawn.args`). */
  args: string[] | string;
  cwd: string;
  env: Record<string, string>;
}

const MIN_COLS = 2;
const MIN_ROWS = 1;

export function spawnLocalPty(options: LocalSpawnOptions): LocalPtySession {
  const { id, command, args, cwd, env, cols, rows } = options;

  log.info('LocalPtySession:spawn', {
    id,
    command,
    args,
    cwd,
    cols,
    rows,
  });

  try {
    const proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    suppressExpectedNodePtyErrors(proc);
    return new LocalPtySession(id, proc);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to spawn PTY: ${message}`);
  }
}

export class LocalPtySession implements Pty {
  readonly id: string;
  /** Settles once a `kill()` has ended the terminal's whole process tree (Windows). */
  private treeStopped: Promise<void> | null = null;
  /** node-pty has reported the exit: there is nothing left to end. */
  private exitReported = false;
  /** How `kill()` ended the terminal (Windows): its process tree, or its console. */
  private endedBy: 'tree' | 'console' | null = null;

  constructor(
    id: string,
    private readonly proc: IPty
  ) {
    this.id = id;
    proc.onExit(() => {
      this.exitReported = true;
    });
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    const c = Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
    const r = Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
    try {
      this.proc.resize(c, r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(msg)) {
        return;
      }
      log.error('LocalPtySession:resize failed', { cols: c, rows: r, error: msg });
    }
  }

  /**
   * Whether the terminal's shell has exited. On Windows this is known before
   * `onExit`, which node-pty holds back until the output has been quiet.
   */
  hasShellExited(): boolean {
    if (process.platform !== 'win32') return this.exitReported;
    return hasConptyShellExited(this.proc);
  }

  /**
   * Ends the terminal. On Windows its exit is reported only once every
   * process it ran is gone (`onExit`): node-pty's ConPTY kill reports exit as
   * soon as its socket closes, kills the console's processes later through a
   * forked helper, and never reaches one started detached — and lane Delete
   * removes the checkout on that exit (devstation-lvp).
   *
   * The tree is killed by the shell's pid only while the shell is alive
   * (devstation-v1x2): once it has exited, that pid may be another process's.
   * A shell already gone leaves at most processes attached to its console, so
   * the console is closed instead, which also makes node-pty report the exit.
   * This narrows the window to the moment between the check and taskkill
   * starting; it does not close it (Node cannot hold the shell's handle).
   */
  kill(): void {
    if (process.platform !== 'win32') {
      this.proc.kill();
      return;
    }
    if (this.treeStopped) return;
    const plan = planKill(this.killState());
    if (plan === 'none') return;
    if (plan === 'console') {
      // Closed first: if the native close throws, kill() throws and a later kill() can retry.
      this.closeConsole();
      this.treeStopped = Promise.resolve();
      return;
    }
    this.endedBy = 'tree';
    this.treeStopped = killProcessTree(this.proc.pid).then(
      (outcome) => this.finishTreeKill(outcome),
      (error: unknown) => {
        log.error('LocalPtySession:kill — processes outlived the kill', {
          id: this.id,
          pid: this.proc.pid,
          error: error instanceof Error ? error.message : String(error),
        });
        this.finishTreeKill('outlived');
      }
    );
  }

  private killState(): KillState {
    return { exitReported: this.exitReported, shellExited: this.hasShellExited() };
  }

  private finishTreeKill(outcome: TreeKillResult): void {
    const next = planAfterTreeKill({ ...this.killState(), outcome });
    if (next === 'console') this.closeConsole();
    else if (next === 'node-pty') this.proc.kill();
  }

  /** How the last `kill()` ended the terminal on Windows; null before any kill. */
  killedBy(): 'tree' | 'console' | null {
    return this.endedBy;
  }

  private closeConsole(): void {
    this.endedBy = 'console';
    closeConptyConsole(this.proc);
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      const info = { exitCode, signal: normalizeSignal(signal) };
      if (this.treeStopped) void this.treeStopped.then(() => handler(info));
      else handler(info);
    });
  }
}
