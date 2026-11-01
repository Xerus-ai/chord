import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { db } from '@main/db/client';
import { workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { releaseHeldSlot } from './release-solo';
import { announceSlot, findLaneSlot, runInSlot } from './solo-slots';

/** A lane holding Solo cannot go while the root changed during Solo: nothing is discarded silently. */
export type SoloRemovalRefusal = { type: 'solo_root_changed'; files: string[]; message: string };

/**
 * Before a lane is deleted or archived (plan §"Decisions for Phase 4", Slot +
 * queue): a queued lane leaves the queue; the holder releases first — its
 * runs stop, the root returns to its branch, the slot goes to the next lane
 * — and when the root changed during Solo the removal is refused with the
 * files, for the user to release from the Run tab (where "Discard and
 * release" is offered). A lane in no slot passes straight through.
 */
export async function releaseLaneSoloForRemoval(
  laneId: string
): Promise<Result<void, SoloRemovalRefusal>> {
  const found = findLaneSlot(laneId);
  if (!found) return ok();
  const { slot } = found;
  return runInSlot(slot.repoId, async (): Promise<Result<void, SoloRemovalRefusal>> => {
    const index = slot.queue.indexOf(laneId);
    if (index >= 0) {
      slot.queue.splice(index, 1);
      announceSlot(slot);
      return ok();
    }
    if (slot.holder?.laneId !== laneId) return ok();
    const released = await releaseHeldSlot(slot, false, askScriptApproval);
    if (released.success) {
      log.info('[solo] released the Solo of a lane that is going', {
        laneId,
        handedTo: released.data.handedTo?.laneId ?? null,
        skipped: released.data.skipped,
      });
      return ok();
    }
    if (released.error.type === 'solo_not_held') return ok();
    const { files } = released.error;
    return err({
      type: 'solo_root_changed' as const,
      files,
      message:
        `This branch is soloing in ${slot.rootPath}, which changed during Solo ` +
        `(${files.join(', ')}). Release it in the Run tab first — "Discard and release" ` +
        'drops those changes.',
    });
  });
}

/**
 * Every lane of the item out of the Solo queue, and its Solo released,
 * before anything goes — a holder first, so a refusal (the root changed
 * during Solo) comes before any queued lane of the item has left the queue.
 */
export async function releaseWorkItemSoloForRemoval(
  workItemId: string
): Promise<Result<void, SoloRemovalRefusal>> {
  const laneIds = (
    await db
      .select({ id: workItemWorktrees.id })
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.workItemId, workItemId))
  ).map((lane) => lane.id);
  const holdersFirst = [...laneIds].sort(
    (a, b) =>
      Number(findLaneSlot(b)?.role === 'holder') - Number(findLaneSlot(a)?.role === 'holder')
  );
  for (const laneId of holdersFirst) {
    const released = await releaseLaneSoloForRemoval(laneId);
    if (!released.success) return released;
  }
  return ok();
}
