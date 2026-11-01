import { appendFileSync, existsSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import { serializeProvisionError } from '@shared/work-item-provision-error';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';

/**
 * Boot-time cleanup of lane work no process survived. Provisioning and setup
 * are only in progress while the run that started them is alive (setup's
 * `inFlight` map, provisioning's pending promise); after a quit or crash their
 * `provisioning` / `pending` / `running` rows would wait forever, with no Retry
 * offered and agents held back. Each becomes `failed`, with the reason where
 * the user reads it, so Retry starts it again.
 *
 * Runs before the RPC router is registered, so no provisioning or setup of
 * this run can have started yet.
 */

const PROVISION_INTERRUPTED =
  'Creating the checkout was interrupted when Chord closed. Retry to create it again.';
const SETUP_INTERRUPTED = 'Setup was interrupted when Chord closed. Retry to run it again.';

export interface LaneReconcileSummary {
  interruptedProvisions: number;
  interruptedSetups: number;
}

export function reconcileLanesOnStartup(): LaneReconcileSummary {
  const provisions = db
    .update(workItems)
    .set({
      provisionStatus: 'failed',
      provisionError: serializeProvisionError({
        type: 'interrupted',
        message: PROVISION_INTERRUPTED,
      }),
    })
    .where(eq(workItems.provisionStatus, 'provisioning'))
    .returning({ id: workItems.id })
    .all();

  // A lane whose checkout was never created keeps `pending`: Retry provisions
  // it, and provisioning starts its setup.
  const setups = db
    .select({ id: workItemWorktrees.id, setupLogPath: workItemWorktrees.setupLogPath })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(
      and(
        inArray(workItemWorktrees.setupStatus, ['pending', 'running']),
        eq(workItems.provisionStatus, 'ready')
      )
    )
    .all();

  for (const lane of setups) {
    db.update(workItemWorktrees)
      .set({ setupStatus: 'failed' })
      .where(eq(workItemWorktrees.id, lane.id))
      .run();
    if (lane.setupLogPath && existsSync(lane.setupLogPath)) {
      appendFileSync(lane.setupLogPath, `[chord] ${SETUP_INTERRUPTED}\n`);
    } else {
      // No log to write to (setup never started, or its checkout is gone):
      // the reason is here, and the bar still offers Retry.
      log.warn('[lanes] setup interrupted by the last shutdown; no log to note it in', {
        laneId: lane.id,
        logPath: lane.setupLogPath,
      });
    }
  }

  const summary = { interruptedProvisions: provisions.length, interruptedSetups: setups.length };
  if (summary.interruptedProvisions > 0 || summary.interruptedSetups > 0) {
    log.info('[lanes] failed provisioning/setup interrupted by the last shutdown', summary);
  }
  return summary;
}
