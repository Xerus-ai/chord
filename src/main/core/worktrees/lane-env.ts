import net from 'node:net';
import { eq, isNotNull } from 'drizzle-orm';
import { buildLaneEnvVars } from '@shared/task/envVars';
import { resolveDefaultBaseRef } from '@main/core/repo-config/resolve-lane-base';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { resolveMainRepoPathForWorkItem } from './repo-path';
import { findWorktreeRow } from './worktree-lookup';

/**
 * The lane environment (`buildLaneEnvVars`) for one lane, and the port block
 * behind its CHORD_PORT.
 *
 * Each lane owns a block of LANE_PORT_BLOCK_SIZE ports starting at
 * `port_base`: allocated once, never shared with another lane, and never
 * starting on a port something else is already listening on. It replaces a
 * hash of the checkout path, which two lanes could collide on with nothing
 * noticing until both dev servers fought over one port.
 */

export const LANE_PORT_BLOCK_SIZE = 10;
const PORT_RANGE_START = 50_000;
const PORT_RANGE_END = 60_000;

let allocation: Promise<unknown> = Promise.resolve();

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function allocatePortBlock(laneId: string): Promise<number> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  if (row.portBase !== null) return row.portBase;

  const taken = new Set(
    db
      .select({ portBase: workItemWorktrees.portBase })
      .from(workItemWorktrees)
      .where(isNotNull(workItemWorktrees.portBase))
      .all()
      .map((r) => r.portBase)
  );
  for (let base = PORT_RANGE_START; base < PORT_RANGE_END; base += LANE_PORT_BLOCK_SIZE) {
    if (taken.has(base)) continue;
    if (!(await isPortFree(base))) continue;
    db.update(workItemWorktrees)
      .set({ portBase: base })
      .where(eq(workItemWorktrees.id, laneId))
      .run();
    return base;
  }
  throw new Error(`No free port block between ${PORT_RANGE_START} and ${PORT_RANGE_END}`);
}

/** The lane's port block, allocating it on first use. Allocations run one at a time. */
export function ensureLanePortBlock(laneId: string): Promise<number> {
  const next = allocation.then(
    () => allocatePortBlock(laneId),
    () => allocatePortBlock(laneId)
  );
  allocation = next.catch(() => undefined);
  return next;
}

export async function buildLaneEnv(laneId: string): Promise<Record<string, string>> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  const [workItem] = db
    .select()
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1)
    .all();
  if (!workItem) throw new Error(`Lane ${laneId} references missing work item ${row.workItemId}`);

  const sourcePath = await resolveMainRepoPathForWorkItem(workItem, row);
  let targetRef = row.targetRef;
  if (!targetRef) {
    // Lanes created before target refs were recorded merge into the default.
    const resolved = await resolveDefaultBaseRef(sourcePath);
    if (!resolved.success) throw new Error(resolved.error.message);
    targetRef = resolved.data;
  }

  return buildLaneEnvVars({
    laneId,
    workItemId: workItem.id,
    workItemName: workItem.name,
    checkoutPath: row.path,
    sourcePath,
    targetRef,
    portBase: await ensureLanePortBlock(laneId),
  });
}
