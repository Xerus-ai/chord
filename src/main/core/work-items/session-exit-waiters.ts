/**
 * Who is waiting for a session's process to actually exit. `stopSession`
 * only asks the process to go (an interrupt, a kill); its exit arrives later
 * through the transport's onExit, which session-service routes here. Removing
 * the checkout a session ran in waits for that exit: on Windows a process
 * still holding its cwd there makes the delete fail.
 */
const waiters = new Map<string, Set<(exited: boolean) => void>>();

/** True once the session's process exits; false if it has not within `timeoutMs`. */
export function waitForSessionExit(sessionId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const set = waiters.get(sessionId) ?? new Set();
    waiters.set(sessionId, set);
    const settle = (exited: boolean) => {
      clearTimeout(timer);
      set.delete(settle);
      if (set.size === 0 && waiters.get(sessionId) === set) waiters.delete(sessionId);
      resolve(exited);
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    set.add(settle);
  });
}

/** Called for every session process exit (session-service's handleSessionExit). */
export function notifySessionExited(sessionId: string): void {
  const set = waiters.get(sessionId);
  if (!set) return;
  for (const settle of [...set]) settle(true);
}
