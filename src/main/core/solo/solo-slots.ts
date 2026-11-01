import { eq } from 'drizzle-orm';
import { soloChangedChannel } from '@shared/events/soloEvents';
import type { SoloLaneRef, SoloView } from '@shared/solo';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';

/**
 * Every repository's Solo slot in this run of the app (plan §"Decisions for
 * Phase 4", Slot + queue — runtime only, the queue does not survive a
 * restart): the lane holding the root, the lanes queued for it, and a hold a
 * previous run left on a root that changed since. Every change is announced
 * on `soloChangedChannel` with the repository's whole view.
 *
 * Operations on one repository's slot run one at a time (`runInSlot`):
 * taking, handing over and releasing the root are git work and processes
 * that must not interleave.
 */

export interface SoloSlot {
  repoId: string;
  rootPath: string;
  holder: { laneId: string; since: string } | null;
  queue: string[];
  interrupted: { laneId: string; branch: string | null; files: string[] } | null;
}

const slots = new Map<string, SoloSlot>();
const chains = new Map<string, Promise<unknown>>();

export function findSlot(repoId: string): SoloSlot | undefined {
  return slots.get(repoId);
}

/**
 * The repository's slot. An idle one (nothing held, queued or interrupted)
 * takes the repository's current root path: a hold keeps the path it began
 * on, but a repository's folder can move between holds.
 */
export function ensureSlot(repoId: string, rootPath: string): SoloSlot {
  let slot = slots.get(repoId);
  if (!slot) {
    slot = { repoId, rootPath, holder: null, queue: [], interrupted: null };
    slots.set(repoId, slot);
  } else if (!slot.holder && !slot.interrupted && slot.queue.length === 0) {
    slot.rootPath = rootPath;
  }
  return slot;
}

export function listSlots(): SoloSlot[] {
  return [...slots.values()];
}

/** The slot a lane holds or queues in, if any. */
export function findLaneSlot(laneId: string): { slot: SoloSlot; role: 'holder' | 'queued' } | null {
  for (const slot of slots.values()) {
    if (slot.holder?.laneId === laneId) return { slot, role: 'holder' };
    if (slot.queue.includes(laneId)) return { slot, role: 'queued' };
  }
  return null;
}

/** Runs `operation` once every earlier operation on the repository's slot has settled. */
export function runInSlot<T>(repoId: string, operation: () => Promise<T>): Promise<T> {
  const tail = chains.get(repoId) ?? Promise.resolve();
  const result = tail.then(operation, operation);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  chains.set(repoId, settled);
  void settled.then(() => {
    if (chains.get(repoId) === settled) chains.delete(repoId);
  });
  return result;
}

function describeLane(laneId: string): SoloLaneRef {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} is in a Solo slot but has no row`);
  const [item] = db
    .select({ name: workItems.name })
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1)
    .all();
  if (!item) throw new Error(`Lane ${laneId} references missing work item ${row.workItemId}`);
  return { laneId, workItemId: row.workItemId, workItemName: item.name, branch: row.branchName };
}

export function buildSoloView(repoId: string, rootPath: string): SoloView {
  const slot = slots.get(repoId);
  return {
    repoId,
    rootPath,
    holder: slot?.holder ? { ...describeLane(slot.holder.laneId), since: slot.holder.since } : null,
    queue: (slot?.queue ?? []).map(describeLane),
    interrupted: slot?.interrupted ?? null,
  };
}

export function announceSlot(slot: SoloSlot): void {
  events.emit(soloChangedChannel, buildSoloView(slot.repoId, slot.rootPath));
}
