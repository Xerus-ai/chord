import { buildLaneEnv } from '@main/core/worktrees/lane-env';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';

/**
 * The lane environment for the lane a session runs in — the same contract
 * setup and run scripts get (`buildLaneEnvVars`), for every session kind and
 * transport.
 */
export function resolveSessionLaneEnv(sessionId: string): Promise<Record<string, string>> {
  return buildLaneEnv(resolveSessionWorktreeRow(sessionId).id);
}
