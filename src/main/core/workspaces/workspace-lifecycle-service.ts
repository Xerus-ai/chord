import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import type { IDisposable } from '@main/lib/lifecycle';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type LifecycleScript = {
  type: 'setup' | 'run' | 'teardown';
  script: string;
};

/**
 * Runs a workspace's lifecycle scripts (its teardown) through the
 * workspace's terminal provider, each as its own shell-line process — not
 * typed into a shell, so it exits by itself on every platform (cmd.exe does
 * not split `<script>; exit` on `;`).
 */
export class LifecycleScriptService implements IDisposable {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly terminals: TerminalProvider;

  constructor({
    projectId,
    workspaceId,
    terminals,
  }: {
    projectId: string;
    workspaceId: string;
    terminals: TerminalProvider;
  }) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.terminals = terminals;
  }

  /**
   * Starts `script`; with `waitForExit`, resolves once its process has
   * exited, whatever its exit code. The wait is on the process itself: the
   * PTY exit event main emits goes to the renderer, never back to main.
   */
  async runLifecycleScript(
    script: LifecycleScript,
    options: { waitForExit?: boolean; initialSize?: { cols: number; rows: number } } = {}
  ): Promise<void> {
    const { waitForExit = false, initialSize = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } } =
      options;
    const terminalId = await createScriptTerminalId({
      projectId: this.projectId,
      scopeId: this.workspaceId,
      type: script.type,
      script: script.script,
    });
    const sessionId = makePtySessionId(this.projectId, this.workspaceId, terminalId);

    await this.terminals.spawnLifecycleScript({
      terminal: {
        id: terminalId,
        projectId: this.projectId,
        taskId: this.workspaceId,
        name: script.type,
      },
      command: script.script,
      initialSize,
      respawnOnExit: false,
      preserveBufferOnExit: true,
      watchDevServer: script.type === 'run',
    });

    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) {
      throw new Error(
        `Lifecycle script session unavailable for ${script.type} in workspace ${this.workspaceId}`
      );
    }
    if (waitForExit) {
      await new Promise<void>((resolve) => pty.onExit(() => resolve()));
    }
  }

  async dispose(): Promise<void> {
    await this.terminals.destroyAll();
  }
}
