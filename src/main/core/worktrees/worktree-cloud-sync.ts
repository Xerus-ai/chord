/**
 * Cloud sync of worktree METADATA (T0.8, D2). Debounced per work item: a
 * burst of local changes (create + a title rename a moment later, or several
 * turns finishing in quick succession) collapses into one push instead of
 * one per event — the sync-queue's 'worktrees' entity already whole-replaces
 * on merge (sync-queue-service.ts), so nothing is lost by waiting.
 *
 * The payload combines two sources rather than either alone:
 *  - `collectSidebarSummaries` for `bucket`/`diffStats` on NON-archived
 *    worktrees — the same derivation the sidebar itself renders, not a
 *    second copy of the bucket logic.
 *  - the raw `work_item_worktrees` table for every row (including archived)
 *    for `branchName`/`baseBranch`/`title`/`isPrimary`/`archivedAt`, none of
 *    which the sidebar summary carries. Archived rows are sent with their
 *    last-known metadata and no live bucket (see `toEntry` below) — the
 *    simplest correct choice: a teammate's Team sub-rows keep seeing the
 *    item's recent worktree history, and archival can never regress by being
 *    silently omitted from the next push.
 */
import type { CloudWorktreePutEntry, CloudWorktreeStatusBucket } from '@chord/protocol';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { gitStateCaptureService } from '../work-items/git-state-capture';
import { collectSidebarSummaries } from '../work-items/sidebar-summaries';
import { syncQueueService } from '../work-items/sync-queue-service';

const DEBOUNCE_MS = 2_000;

/** Archived worktrees carry no live bucket — 'idle' is the honest rest state,
 * not a guess at what it was doing when archived. */
const ARCHIVED_BUCKET: CloudWorktreeStatusBucket = 'idle';

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function toIsoWithOffset(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Debounces and enqueues a full worktree-list push for `workItemId`. Safe to
 * call from any worktree/work-item mutation site — a no-op when the item
 * isn't currently a sync target (see `gitStateCaptureService.isSyncTarget`,
 * the same "is this item shared" predicate git-state and plan requests use)
 * or when the debounce window is already pending for this item.
 */
export function scheduleWorktreeCloudSync(workItemId: string): void {
  if (pendingTimers.has(workItemId)) return;
  const timer = setTimeout(() => {
    pendingTimers.delete(workItemId);
    void runSync(workItemId);
  }, DEBOUNCE_MS);
  pendingTimers.set(workItemId, timer);
}

function buildEntry(
  row: WorkItemWorktreeRow,
  liveById: ReadonlyMap<
    string,
    { bucket: CloudWorktreeStatusBucket; diffStats: { added: number; removed: number } | null }
  >
): CloudWorktreePutEntry {
  const archived = row.archivedAt !== null;
  const live = archived ? undefined : liveById.get(row.id);

  return {
    id: row.id,
    branch_name: row.branchName,
    base_branch: row.baseBranch,
    title: row.title,
    is_primary: row.isPrimary === 1,
    status_bucket: live?.bucket ?? ARCHIVED_BUCKET,
    additions: live?.diffStats?.added ?? 0,
    deletions: live?.diffStats?.removed ?? 0,
    diff_known: live ? live.diffStats !== null : false,
    archived_at: row.archivedAt !== null ? toIsoWithOffset(row.archivedAt) : null,
  };
}

async function runSync(workItemId: string): Promise<void> {
  try {
    if (!gitStateCaptureService.isSyncTarget(workItemId)) return;

    const rows = await db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.workItemId, workItemId));
    if (rows.length === 0) return;

    const [summary] = await collectSidebarSummaries([workItemId]);
    const liveById = new Map(
      (summary?.worktrees ?? []).map((w) => [w.id, { bucket: w.bucket, diffStats: w.diffStats }])
    );

    const entries = rows.map((row) => buildEntry(row, liveById));
    syncQueueService.enqueueWorktrees(workItemId, { worktrees: entries });
  } catch (error) {
    // Fail-soft by design, matching git-state-capture's per-item catch: a
    // build/enqueue failure for one debounce cycle must not crash the
    // trigger site (worktree create, session status update, ...) that
    // called this. The next trigger retries from scratch.
    log.warn('[worktree-cloud-sync] failed to build/enqueue worktree snapshot', {
      workItemId,
      error: String(error),
    });
  }
}
