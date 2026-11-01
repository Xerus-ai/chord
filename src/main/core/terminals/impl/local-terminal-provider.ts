import { makePtySessionId } from '@shared/ptySessionId';
import type { Terminal } from '@shared/terminals';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  logLocalPtySpawnWarnings,
  resolveLocalPtySpawn,
  type PtyCommandSpec,
  type PtySpawnIntent,
} from '@main/core/pty/pty-spawn-platform';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { log } from '@main/lib/logger';
import { wireTerminalDevServerWatcher } from '../dev-server-watcher';
import { type LifecycleScriptSpawnRequest, type TerminalProvider } from '../terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_RESPAWNS = 2;
// The budget targets crash LOOPS (respawn delay is 500ms, so a loop burns
// its budget within seconds). A respawn this long after the previous one is
// a fresh incident, not the same loop — without the reset, isolated crashes
// spread over months silently exhaust the budget and disable auto-recovery.
const RESPAWN_BUDGET_WINDOW_MS = 60_000;

type SpawnPolicy = {
  respawnOnExit: boolean;
  preserveBufferOnExit: boolean;
  watchDevServer: boolean;
};

export class LocalTerminalProvider implements TerminalProvider {
  private sessions = new Map<string, Pty>();
  private knownSessionIds = new Set<string>();
  private respawnCounts = new Map<string, { count: number; lastAt: number }>();
  // Pending crash-respawn timers, so killTerminal/destroyAll can cancel them
  // — an uncancellable timer respawned ptys into torn-down workspaces.
  private respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly projectId: string;
  private readonly scopeId: string;
  private readonly taskPath: string;
  private readonly tmux: boolean;
  /** Read at each spawn, so it reflects the user's approval at that moment. */
  private readonly resolveShellSetup: () => Promise<string | undefined>;
  private readonly ctx: IExecutionContext;
  private readonly taskEnvVars: Record<string, string>;

  constructor({
    projectId,
    scopeId,
    taskPath,
    tmux = false,
    resolveShellSetup = async () => undefined,
    ctx,
    taskEnvVars = {},
  }: {
    projectId: string;
    scopeId: string;
    taskPath: string;
    tmux?: boolean;
    resolveShellSetup?: () => Promise<string | undefined>;
    ctx: IExecutionContext;
    taskEnvVars?: Record<string, string>;
  }) {
    this.projectId = projectId;
    this.scopeId = scopeId;
    this.taskPath = taskPath;
    this.tmux = tmux;
    this.resolveShellSetup = resolveShellSetup;
    this.ctx = ctx;
    this.taskEnvVars = taskEnvVars;
  }

  async spawnTerminal(
    terminal: Terminal,
    initialSize: { cols: number; rows: number } = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    command?: { command: string; args: string[] }
  ): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      command ? { kind: 'argv', command: command.command, args: command.args } : undefined,
      {
        respawnOnExit: true,
        preserveBufferOnExit: false,
        watchDevServer: true,
      }
    );
  }

  async spawnLifecycleScript({
    terminal,
    command,
    initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS },
    respawnOnExit = false,
    preserveBufferOnExit = true,
    watchDevServer = false,
  }: LifecycleScriptSpawnRequest): Promise<void> {
    return this.spawnWithPolicy(
      terminal,
      initialSize,
      command === undefined ? undefined : { kind: 'shell-line', commandLine: command },
      {
        respawnOnExit,
        preserveBufferOnExit,
        watchDevServer,
      }
    );
  }

  private async spawnWithPolicy(
    terminal: Terminal,
    initialSize: { cols: number; rows: number },
    command: PtyCommandSpec | undefined,
    policy: SpawnPolicy
  ): Promise<void> {
    // Resolved before the has-check below, so nothing awaits between that
    // check and registering the session.
    const shellSetup = await this.resolveShellSetup();
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    this.knownSessionIds.add(sessionId);
    if (this.sessions.has(sessionId)) return;

    const intent: PtySpawnIntent = command
      ? {
          kind: 'run-command',
          cwd: this.taskPath,
          command,
          shellSetup,
          tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
        }
      : {
          kind: 'interactive-shell',
          cwd: this.taskPath,
          shellSetup,
          tmuxSessionName: this.tmux ? makeTmuxSessionName(sessionId) : undefined,
        };
    const resolved = resolveLocalPtySpawn({
      platform: process.platform,
      env: process.env,
      intent,
    });

    logLocalPtySpawnWarnings('LocalTerminalProvider', resolved.warnings, {
      terminalId: terminal.id,
      sessionId,
    });

    const pty = spawnLocalPty({
      id: sessionId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: { ...buildTerminalEnv(), ...this.taskEnvVars },
      cols: initialSize.cols,
      rows: initialSize.rows,
    });

    if (policy.watchDevServer) {
      wireTerminalDevServerWatcher({ pty, scopeId: this.scopeId, terminalId: terminal.id });
    }

    pty.onExit(() => {
      const shouldRespawn = policy.respawnOnExit && this.sessions.has(sessionId);
      this.sessions.delete(sessionId);
      if (!policy.preserveBufferOnExit) {
        ptySessionRegistry.unregister(sessionId);
      }
      if (shouldRespawn && !this.tmux) {
        const previous = this.respawnCounts.get(sessionId);
        const now = Date.now();
        const count =
          previous && now - previous.lastAt < RESPAWN_BUDGET_WINDOW_MS ? previous.count + 1 : 1;
        this.respawnCounts.set(sessionId, { count, lastAt: now });

        if (count > MAX_RESPAWNS) {
          log.error('LocalTerminalProvider: respawn limit reached, giving up', {
            terminalId: terminal.id,
            respawnCount: count,
          });
          this.respawnCounts.delete(sessionId);
          return;
        }

        const timer = setTimeout(() => {
          this.respawnTimers.delete(sessionId);
          // The terminal may have been killed or the workspace torn down
          // while the timer was pending — never respawn a session that is
          // no longer wanted.
          if (!this.knownSessionIds.has(sessionId)) return;
          this.spawnWithPolicy(terminal, initialSize, command, policy).catch((e) => {
            log.error('LocalTerminalProvider: respawn failed', {
              terminalId: terminal.id,
              error: String(e),
            });
          });
        }, 500);
        this.respawnTimers.set(sessionId, timer);
      }
    });

    ptySessionRegistry.register(sessionId, pty, {
      preserveBufferOnExit: policy.preserveBufferOnExit,
    });
    this.sessions.set(sessionId, pty);
  }

  async killTerminal(terminalId: string): Promise<void> {
    const sessionId = makePtySessionId(this.projectId, this.scopeId, terminalId);
    this.knownSessionIds.delete(sessionId);
    this.cancelRespawn(sessionId);
    const pty = this.sessions.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch {}
      this.sessions.delete(sessionId);
      ptySessionRegistry.unregister(sessionId);
    }
    if (this.tmux) {
      await killTmuxSession(this.ctx, makeTmuxSessionName(sessionId));
    }
  }

  async destroyAll(): Promise<void> {
    const sessionIds = Array.from(this.knownSessionIds);
    await this.detachAll();
    if (this.tmux) {
      await Promise.all(sessionIds.map((id) => killTmuxSession(this.ctx, makeTmuxSessionName(id))));
    }
    this.knownSessionIds.clear();
  }

  async detachAll(): Promise<void> {
    for (const timer of this.respawnTimers.values()) {
      clearTimeout(timer);
    }
    this.respawnTimers.clear();
    for (const [sessionId, pty] of this.sessions) {
      try {
        pty.kill();
      } catch {}
      ptySessionRegistry.unregister(sessionId);
    }
    this.sessions.clear();
  }

  private cancelRespawn(sessionId: string): void {
    const timer = this.respawnTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.respawnTimers.delete(sessionId);
  }
}
