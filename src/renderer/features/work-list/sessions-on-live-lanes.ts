/**
 * The sessions the centre strip shows: those on the work item's live lanes,
 * and those with no lane (rows from before lanes). A session on an archived
 * lane is left out, so its tab goes like a session that no longer exists and
 * the strip shows another (devstation-lf5i); its checkout is gone, and Restore
 * brings the lane and its chat back.
 */
export function keepSessionsOnLiveLanes<T extends { worktreeId: string | null }>(
  sessions: readonly T[],
  liveWorktreeIds: ReadonlySet<string>
): T[] {
  return sessions.filter(
    (session) => session.worktreeId === null || liveWorktreeIds.has(session.worktreeId)
  );
}
