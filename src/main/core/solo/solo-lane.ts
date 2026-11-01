import { err, ok, type Result } from '@shared/result';
import type { SoloHoldError, SoloLaneError, SoloLaneOutcome } from '@shared/solo';
import { resolveLaneScriptToRun } from '@main/core/lane-runs/resolve-lane-script';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { announceSlot, ensureSlot, findLaneSlot, runInSlot } from './solo-slots';
import { syncSoloFromLane } from './sync-solo-from-lane';
import { resolveSoloLane, takeSoloSlot } from './take-solo-slot';

/**
 * "Solo this branch": a free slot puts the lane in the root and starts its
 * run scripts there; a taken one queues it (first in, first out, once).
 * The lane's scripts are asked about first, before the root is touched or
 * the lane queued: Don't run changes nothing, and the hand-over later runs
 * what the user already approved. Refusals (`root_dirty`, `root_busy`…)
 * never queue the lane.
 */
export async function soloLane(
  laneId: string,
  ask: AskScriptApproval
): Promise<Result<SoloLaneOutcome, SoloLaneError>> {
  const context = await resolveSoloLane(laneId);
  if (!context.success) return context;
  const { repoId, rootPath, scriptIds } = context.data;

  for (const scriptId of scriptIds) {
    const approved = await resolveLaneScriptToRun(laneId, { kind: 'run', scriptId }, ask);
    if (!approved.success) return approved;
  }

  return runInSlot(repoId, async (): Promise<Result<SoloLaneOutcome, SoloLaneError>> => {
    const slot = ensureSlot(repoId, rootPath);
    if (slot.holder?.laneId === laneId) return ok({ status: 'holding' as const, starts: [] });
    const index = slot.queue.indexOf(laneId);
    if (index >= 0) return ok({ status: 'queued' as const, position: index + 1 });
    if (slot.interrupted) return err({ type: 'solo_interrupted' as const });
    if (slot.holder) {
      slot.queue.push(laneId);
      announceSlot(slot);
      return ok({ status: 'queued' as const, position: slot.queue.length });
    }
    const taken = await takeSoloSlot(slot, laneId, scriptIds, ask);
    if (!taken.success) return taken;
    return ok({ status: 'holding' as const, starts: taken.data });
  });
}

/** "Leave queue". */
export async function leaveSoloQueue(
  laneId: string
): Promise<Result<void, { type: 'not_queued' }>> {
  const found = findLaneSlot(laneId);
  if (found?.role !== 'queued') return err({ type: 'not_queued' as const });
  const { slot } = found;
  return runInSlot(slot.repoId, async (): Promise<Result<void, { type: 'not_queued' }>> => {
    const index = slot.queue.indexOf(laneId);
    if (index < 0) return err({ type: 'not_queued' as const });
    slot.queue.splice(index, 1);
    announceSlot(slot);
    return ok();
  });
}

/** "Sync from lane": the holder's current state into the root, runs untouched (`syncSoloFromLane`). */
export async function syncSolo(laneId: string): Promise<Result<void, SoloHoldError>> {
  const found = findLaneSlot(laneId);
  if (found?.role !== 'holder') return err({ type: 'solo_not_held' as const });
  const { slot } = found;
  return runInSlot(slot.repoId, async (): Promise<Result<void, SoloHoldError>> => {
    if (slot.holder?.laneId !== laneId) return err({ type: 'solo_not_held' as const });
    const synced = await syncSoloFromLane({ rootPath: slot.rootPath });
    if (!synced.success) return synced;
    return ok();
  });
}
