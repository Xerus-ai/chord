import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import type { SoloReleaseTarget } from '@shared/solo';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { readSoloView } from './read-solo-view';
import { releaseSolo } from './release-solo';
import { leaveSoloQueue, soloLane, syncSolo } from './solo-lane';
import { restartSoloRun, runSoloTest } from './solo-runs';

/**
 * Solo's RPCs (`rpc.solo.*`): a repository's slot, taking or queueing for
 * it, leaving the queue, syncing and releasing, and the holder's Restart and
 * Run tests in the root. Unapproved team scripts are asked about in main's
 * own window; changes arrive on `soloChangedChannel`.
 */
export const soloController = createRPCController({
  getState: async (repoId: string) => ok(await readSoloView(repoId)),

  soloLane: (laneId: string) => soloLane(laneId, askScriptApproval),

  release: (args: SoloReleaseTarget & { discardRootChanges: boolean }) =>
    releaseSolo(
      'repoId' in args ? { repoId: args.repoId } : { laneId: args.laneId },
      { discardRootChanges: args.discardRootChanges },
      askScriptApproval
    ),

  leaveQueue: (laneId: string) => leaveSoloQueue(laneId),

  sync: (laneId: string) => syncSolo(laneId),

  restartRun: (args: { laneId: string; scriptId: string }) =>
    restartSoloRun(args, askScriptApproval),

  runTest: (laneId: string) => runSoloTest(laneId, askScriptApproval),
});
