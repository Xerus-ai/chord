/**
 * What `LocalPtySession.kill()` does on Windows, as decisions (devstation-v1x2). The shell's pid
 * goes to `taskkill /T` only while the shell is alive: once it has exited, Windows may have given
 * that pid to another process, and /T would end that process's tree. A shell that exited leaves
 * at most processes attached to its console, so the console is closed instead (which also makes
 * node-pty report the exit). After node-pty reported the exit there is nothing left to end.
 */
export interface KillState {
  /** node-pty has reported the exit (`onExit`). */
  exitReported: boolean;
  /** The shell itself has exited (node-pty's agent knows this before `onExit`). */
  shellExited: boolean;
}

export type KillPlan = 'none' | 'console' | 'tree';

export function planKill({ exitReported, shellExited }: KillState): KillPlan {
  if (exitReported) return 'none';
  if (shellExited) return 'console';
  return 'tree';
}

/** How the tree kill went: ended, no root to walk, or processes still running after it. */
export type TreeKillResult = 'ended' | 'not-found' | 'outlived';

export type AfterTreeKill = 'none' | 'console' | 'node-pty';

export function planAfterTreeKill(state: KillState & { outcome: TreeKillResult }): AfterTreeKill {
  if (state.exitReported || state.outcome === 'ended') return 'none';
  if (state.outcome === 'not-found' || state.shellExited) return 'console';
  // Processes outlived the kill and the shell is alive, so its pid is still its own: node-pty's
  // kill closes the console and ends what is attached to it.
  return 'node-pty';
}
