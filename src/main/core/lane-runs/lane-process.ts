import { spawnLocalPty, type LocalPtySession } from '@main/core/pty/local-pty';
import type { PtyExitInfo } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { wireTerminalDevServerWatcher } from '@main/core/terminals/dev-server-watcher';

/**
 * One process of a lane — a run script or the test script — as a PTY
 * `shell-line` command (`cmd.exe /d /s /c` on Windows, `$SHELL -c`
 * elsewhere): its exit code is the script's, and its terminal's buffer stays
 * readable after it exits.
 */

const COLS = 120;
const ROWS = 30;

/** How long a process asked to stop with Ctrl+C gets before its tree is killed (S3). */
export const STOP_GRACE_MS = 10_000;

/**
 * Set over the lane env. `docker compose up` attached to a terminal shows a
 * keyboard menu that reads Ctrl+C as a key, so Stop's Ctrl+C never reached it
 * and the tree kill left its containers running (S3). Without the menu,
 * Ctrl+C stops the stack (probe-ctrlc: exit 130 in ~1 s, containers gone).
 */
const RUN_ENV_OVERRIDES: Record<string, string> = { COMPOSE_MENU: 'false' };

export interface LaneProcess {
  sessionId: string;
  pty: LocalPtySession;
  /** Settles with the exit, once the process (and on a kill, its whole tree) is gone. */
  exited: Promise<PtyExitInfo>;
  hasExited: () => boolean;
}

export function spawnLaneProcess(args: {
  sessionId: string;
  cwd: string;
  commandLine: string;
  shellSetup?: string;
  env: Record<string, string>;
  /** Run scripts watch for the dev server URL they print; the test script does not. */
  watchUrl?: { scopeId: string; terminalId: string; onUrlChange: (url: string | null) => void };
}): LaneProcess {
  const resolved = resolveLocalPtySpawn({
    platform: process.platform,
    env: process.env,
    intent: {
      kind: 'run-command',
      cwd: args.cwd,
      command: { kind: 'shell-line', commandLine: args.commandLine },
      shellSetup: args.shellSetup,
    },
  });
  logLocalPtySpawnWarnings('lane-runs', resolved.warnings, { sessionId: args.sessionId });

  const pty = spawnLocalPty({
    id: args.sessionId,
    command: resolved.command,
    args: resolved.args,
    cwd: resolved.cwd,
    env: { ...buildTerminalEnv(), ...args.env, ...RUN_ENV_OVERRIDES },
    cols: COLS,
    rows: ROWS,
  });
  let done = false;
  const exited = new Promise<PtyExitInfo>((resolve) => {
    pty.onExit((info) => {
      done = true;
      resolve(info);
    });
  });
  if (args.watchUrl) wireTerminalDevServerWatcher({ pty, ...args.watchUrl });
  ptySessionRegistry.register(args.sessionId, pty, { preserveBufferOnExit: true });
  return { sessionId: args.sessionId, pty, exited, hasExited: () => done };
}

/**
 * Stops a process the way a terminal user would: Ctrl+C, so it can shut down
 * what it started (an attached `docker compose up` stops its containers —
 * S3), then, if it is still running after the grace period, the tree kill.
 * Resolves once it is gone.
 */
export async function stopLaneProcess(proc: LaneProcess): Promise<PtyExitInfo> {
  if (proc.hasExited()) return proc.exited;
  proc.pty.write('\x03');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const graceOver = new Promise<'grace_over'>((resolve) => {
    timer = setTimeout(() => resolve('grace_over'), STOP_GRACE_MS);
  });
  const outcome = await Promise.race([proc.exited, graceOver]);
  clearTimeout(timer);
  if (outcome === 'grace_over') proc.pty.kill();
  return proc.exited;
}
