import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { stopLaneRun, stopLaneTest } from './lane-run-registry';
import { readLaneRunView } from './read-lane-run-view';
import { restartLaneRun, runLaneTest, startLaneRun } from './start-lane-run';

/**
 * The Run tab's RPCs (`rpc.laneRuns.*`). Start, Restart and Run tests ask
 * about an unapproved team script in main's own window; changes arrive on
 * `laneRunChangedChannel`.
 */
export const laneRunsController = createRPCController({
  get: (laneId: string) => readLaneRunView(laneId),

  start: (args: { laneId: string; scriptId: string }) => startLaneRun(args, askScriptApproval),

  stop: async (args: { laneId: string; scriptId: string }) =>
    ok(await stopLaneRun(args.laneId, args.scriptId)),

  restart: (args: { laneId: string; scriptId: string }) => restartLaneRun(args, askScriptApproval),

  runTest: (laneId: string) => runLaneTest({ laneId }, askScriptApproval),

  stopTest: async (laneId: string) => ok(await stopLaneTest(laneId)),
});
