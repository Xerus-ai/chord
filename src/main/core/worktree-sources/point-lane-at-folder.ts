import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { PointLaneAtFolderError } from '@shared/worktree-sources';
import { comparablePath } from '@main/core/utils/comparable-path';
import { scheduleWorktreeCloudSync } from '@main/core/worktrees/worktree-cloud-sync';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { findAdoptableEntry } from './adopt-preflight';
import { readHeldLanePaths, readRepo } from './discover-repo-worktrees';

/**
 * "Point lane at this folder", the action of a `stale_lane` refusal: a lane
 * whose folder was removed outside git moves to the checkout now holding its
 * branch. That checkout was not made by Chord, so the lane becomes
 * `adopted` — Chord never changes it. Nothing in the folder is touched.
 */
export async function pointLaneAtFolder(args: {
  laneId: string;
  path: string;
}): Promise<Result<{ workItemId: string }, PointLaneAtFolderError>> {
  const lane = findWorktreeRow(args.laneId);
  if (!lane) return err({ type: 'lane_not_found' as const });
  const [item] = db
    .select({ repoId: workItems.repoId })
    .from(workItems)
    .where(eq(workItems.id, lane.workItemId))
    .limit(1)
    .all();
  if (!item?.repoId) return err({ type: 'lane_not_found' as const });

  const found = await findAdoptableEntry(readRepo(item.repoId), args.path);
  if (!found.success) return found;
  const folder = found.data.path;
  const holder = readHeldLanePaths().get(comparablePath(folder));
  if (holder && holder !== lane.id)
    return err({ type: 'already_adopted' as const, laneId: holder });

  db.transaction((tx) => {
    tx.update(workItemWorktrees)
      .set({ path: folder, checkoutOrigin: 'adopted' })
      .where(eq(workItemWorktrees.id, lane.id))
      .run();
    // The primary lane is where the work item runs.
    if (lane.isPrimary === 1) {
      tx.update(workItems).set({ repoPath: folder }).where(eq(workItems.id, lane.workItemId)).run();
    }
  });
  log.info('[worktree-sources] pointed a lane at its branch’s folder', {
    laneId: lane.id,
    from: lane.path,
    to: folder,
  });
  scheduleWorktreeCloudSync(lane.workItemId);
  return ok({ workItemId: lane.workItemId });
}
