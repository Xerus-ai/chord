import type { IPty } from 'node-pty';

/**
 * What LocalPtySession needs from node-pty's ConPTY agent that its public API does not give
 * (node-pty 1.1.0, `lib/windowsPtyAgent.js`; devstation-v1x2):
 * - `exitCode` is set by the native exit callback the moment the shell exits, while the public
 *   `onExit` waits until the output has been quiet for 1s, or forever while something writes.
 * - closing the pseudoconsole (`ptyNative.kill`) ends the processes still attached to it and
 *   the output pipe, so node-pty reports the exit. Its public `kill()` would also do that, but
 *   first forks a helper that attaches to the shell's console; with the shell gone the helper
 *   fails, and 5s later node-pty kills the shell's pid, which may by then be another process.
 * The shape is checked on every use: a node-pty that changes it fails loudly here.
 */
interface ConptyAgent {
  exitCode: number | undefined;
  _pty: number;
  _useConptyDll: boolean;
  _ptyNative: { kill(pty: number, useConptyDll: boolean): void };
  _conoutSocketWorker: { dispose(): void };
}

function conptyAgentOf(proc: IPty): ConptyAgent {
  const agent = (proc as unknown as { _agent?: Partial<ConptyAgent> })._agent;
  if (
    !agent ||
    !('exitCode' in agent) ||
    typeof agent._pty !== 'number' ||
    typeof agent._useConptyDll !== 'boolean' ||
    typeof agent._ptyNative?.kill !== 'function' ||
    typeof agent._conoutSocketWorker?.dispose !== 'function'
  ) {
    throw new Error(
      'node-pty ConPTY agent has an unexpected shape; conpty-internals.ts needs updating'
    );
  }
  return agent as ConptyAgent;
}

/** Whether the shell itself has exited (Windows ConPTY), before node-pty reports the exit. */
export function hasConptyShellExited(proc: IPty): boolean {
  return conptyAgentOf(proc).exitCode !== undefined;
}

/** Closes the pseudoconsole without touching any pid: attached processes end, exit follows. */
export function closeConptyConsole(proc: IPty): void {
  const agent = conptyAgentOf(proc);
  agent._ptyNative.kill(agent._pty, agent._useConptyDll);
  agent._conoutSocketWorker.dispose();
}
