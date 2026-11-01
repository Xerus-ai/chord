import { err, ok, type Result } from '@shared/result';
import type {
  SoloHoldError,
  SoloLaneError,
  SoloReleaseOutcome,
  SoloReleaseTarget,
} from '@shared/solo';
import { stopLaneRuns } from '@main/core/lane-runs/lane-run-registry';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { log } from '@main/lib/logger';
import { releaseSoloHost } from './release-solo-host';
import { announceSlot, findLaneSlot, findSlot, runInSlot, type SoloSlot } from './solo-slots';
import { readSoloRootChanges } from './solo-state';
import { resolveSoloLane, takeSoloSlot } from './take-solo-slot';

/** A queued lane's refusal, in the words the release result reports. */
function describeSkip(error: SoloLaneError): string {
  switch (error.type) {
    case 'not_found':
      return 'the lane no longer exists';
    case 'no_repo':
      return 'the lane has no repository';
    case 'not_solo_mode':
      return "the repository's run mode is no longer Solo";
    case 'config_invalid':
      return `its .chord.json cannot be read: ${error.message}`;
    case 'no_script':
      return 'the repository has no run scripts';
    case 'declined':
      return "Don't run was chosen for its scripts";
    case 'setup_running':
      return 'its setup is still running';
    case 'checkout_missing':
      return 'its checkout is not on this machine';
    case 'solo_interrupted':
      return 'an interrupted Solo holds the root';
    case 'solo_held':
      return `the root is held by lane ${error.laneId}`;
    case 'root_busy':
      return `the root is in the middle of a ${error.operation}`;
    case 'root_dirty':
      return `the root has changes: ${error.files.join(', ')}`;
  }
}

/**
 * Hands a free slot to the queued lanes in turn until one takes it. A lane
 * that cannot (its checkout gone, its repository out of Solo mode, the root
 * refusing it — or an unexpected failure) is skipped, reported and logged,
 * and the next one is tried: the queue never sticks silently.
 */
async function handOverSoloSlot(
  slot: SoloSlot,
  ask: AskScriptApproval
): Promise<Pick<SoloReleaseOutcome, 'handedTo' | 'skipped'>> {
  const skipped: SoloReleaseOutcome['skipped'] = [];
  for (let laneId = slot.queue.shift(); laneId !== undefined; laneId = slot.queue.shift()) {
    announceSlot(slot);
    let reason: string;
    try {
      const context = await resolveSoloLane(laneId);
      const taken = context.success
        ? await takeSoloSlot(slot, laneId, context.data.scriptIds, ask)
        : context;
      if (taken.success) return { handedTo: { laneId, starts: taken.data }, skipped };
      reason = describeSkip(taken.error);
    } catch (error) {
      reason = String(error);
    }
    log.warn('[solo] a queued lane could not take the slot; trying the next', {
      repoId: slot.repoId,
      laneId,
      reason,
    });
    skipped.push({ laneId, reason });
  }
  return { handedTo: null, skipped };
}

/**
 * Releases a slot's hold — the holder's, or an interrupted one — and hands
 * the slot on. A holder's root is checked first, so `root_changed` (unless
 * discarding) leaves its runs going; then its runs stop (awaited) and the
 * root is returned (`releaseSoloHost`). The caller runs inside the slot.
 */
export async function releaseHeldSlot(
  slot: SoloSlot,
  discardRootChanges: boolean,
  ask: AskScriptApproval
): Promise<Result<SoloReleaseOutcome, SoloHoldError>> {
  const laneId = slot.holder?.laneId ?? slot.interrupted?.laneId;
  if (laneId === undefined) return err({ type: 'solo_not_held' as const });
  if (slot.holder) {
    if (!discardRootChanges) {
      const files = await readSoloRootChanges(slot.rootPath);
      if (files.length > 0) return err({ type: 'root_changed' as const, files });
    }
    await stopLaneRuns(laneId);
  }
  const released = await releaseSoloHost({ rootPath: slot.rootPath, discardRootChanges });
  if (!released.success) {
    if (released.error.type === 'solo_not_held') {
      // The root holds nothing any more: the slot follows the root.
      slot.holder = null;
      slot.interrupted = null;
      announceSlot(slot);
    }
    return released;
  }
  slot.holder = null;
  slot.interrupted = null;
  announceSlot(slot);
  const handOver = await handOverSoloSlot(slot, ask);
  return ok({ releasedLaneId: laneId, leftovers: released.data.leftovers, ...handOver });
}

/**
 * "Release" (and "Discard and release", and Restore of an interrupted Solo):
 * by repository, or by the lane holding it.
 */
export async function releaseSolo(
  target: SoloReleaseTarget,
  options: { discardRootChanges: boolean },
  ask: AskScriptApproval
): Promise<Result<SoloReleaseOutcome, SoloHoldError>> {
  const slot = 'repoId' in target ? findSlot(target.repoId) : findLaneSlot(target.laneId)?.slot;
  if (!slot) return err({ type: 'solo_not_held' as const });
  return runInSlot(slot.repoId, async (): Promise<Result<SoloReleaseOutcome, SoloHoldError>> => {
    if ('laneId' in target && slot.holder?.laneId !== target.laneId) {
      return err({ type: 'solo_not_held' as const });
    }
    return releaseHeldSlot(slot, options.discardRootChanges, ask);
  });
}
