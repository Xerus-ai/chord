import type { TerminalShell } from '@shared/terminal-shells';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildTerminalEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { log } from '@main/lib/logger';
import type { SessionLifecycleCallbacks } from './session-lifecycle-types';

/**
 * A plain shell terminal (cmd, PowerShell, Git Bash, zsh…) in a session's
 * worktree. Unlike `launchPtyProcess` there is no agent: no hooks, no chat
 * bridge, no classifier, no `.chord.json` shellSetup — the user drives it.
 * Registered under the same `session:<id>` PTY id so the terminal tab and
 * session teardown treat it like any other terminal session.
 */
export function launchShellProcess(
  sessionId: string,
  opts: { cwd: string; shell: TerminalShell; taskEnvVars: Record<string, string> },
  callbacks: SessionLifecycleCallbacks
): { ptyId: string } {
  const ptyId = `session:${sessionId}`;
  const lastSize = ptySessionRegistry.getLastSize(ptyId);

  const pty = spawnLocalPty({
    id: ptyId,
    command: opts.shell.command,
    args: opts.shell.args,
    cwd: opts.cwd,
    env: { ...buildTerminalEnv(), ...opts.taskEnvVars },
    cols: lastSize?.cols ?? 120,
    rows: lastSize?.rows ?? 40,
  });
  ptySessionRegistry.register(ptyId, pty);

  pty.onExit(({ exitCode }) => {
    ptySessionRegistry.unregister(ptyId);
    callbacks.onExit(exitCode);
  });

  log.info('session-service: started shell session', { sessionId, shell: opts.shell.id });
  return { ptyId };
}
