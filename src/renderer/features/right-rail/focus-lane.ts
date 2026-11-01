/**
 * Focusing a lane means focusing something that runs in it: the rail follows
 * the centre's active tab rather than holding a selection of its own
 * (`use-focused-worktree.ts`), so a lane is focused by switching to one of its
 * sessions.
 */

/**
 * The session to switch to for a lane. A session with no `worktreeId` runs in
 * the primary — the same convention the main process uses. Null when the lane
 * has no session to switch to.
 */
export function pickLaneSession(
  laneId: string,
  lanes: readonly { id: string; isPrimary: boolean }[],
  sessions: readonly { id: string; worktreeId: string | null }[]
): string | null {
  const isPrimary = lanes.find((lane) => lane.id === laneId)?.isPrimary ?? false;
  const session = sessions.find((row) =>
    row.worktreeId === null ? isPrimary : row.worktreeId === laneId
  );
  return session?.id ?? null;
}

export function switchToSession(sessionId: string): void {
  window.dispatchEvent(
    new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId } })
  );
}
