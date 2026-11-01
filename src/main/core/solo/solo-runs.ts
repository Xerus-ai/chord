import type { LaneTestState, RunScriptState, StartLaneRunError } from '@shared/lane-runs';
import { err, type Result } from '@shared/result';
import { restartLaneRun, runLaneTest } from '@main/core/lane-runs/start-lane-run';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { findLaneSlot } from './solo-slots';
import { soloRunHost } from './take-solo-slot';

type SoloRunError = StartLaneRunError | { type: 'solo_not_held' };

/** The root the lane holds, or null when it holds none. */
function heldRoot(laneId: string): string | null {
  const found = findLaneSlot(laneId);
  return found?.role === 'holder' ? found.slot.rootPath : null;
}

/**
 * Start / Restart of a run script while the lane holds Solo: in the root,
 * with the Solo env (a stopped script starts; a running one restarts). Stop
 * is the lane's ordinary Stop, since the run state is the lane's.
 */
export async function restartSoloRun(
  args: { laneId: string; scriptId: string },
  ask: AskScriptApproval
): Promise<Result<RunScriptState, SoloRunError>> {
  const root = heldRoot(args.laneId);
  if (root === null) return err({ type: 'solo_not_held' as const });
  return restartLaneRun({ ...args, host: soloRunHost(root) }, ask);
}

/** Run tests while the lane holds Solo: in the root, where its stack runs. */
export async function runSoloTest(
  laneId: string,
  ask: AskScriptApproval
): Promise<Result<LaneTestState, SoloRunError>> {
  const root = heldRoot(laneId);
  if (root === null) return err({ type: 'solo_not_held' as const });
  return runLaneTest({ laneId, host: soloRunHost(root) }, ask);
}
