import { eq } from 'drizzle-orm';
import type { LaneSetupStatus } from '@shared/events/workItemEvents';
import type { LaneRunView } from '@shared/lane-runs';
import { err, ok, type Result } from '@shared/result';
import { formatRunScriptRowTitle } from '@shared/run-scripts';
import { RepoConfigError } from '@main/core/repo-config/read-team-config';
import { resolveLaneBundle } from '@main/core/worktrees/lane-bundle';
import { ensureLanePortBlock, LANE_PORT_BLOCK_SIZE } from '@main/core/worktrees/lane-env';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { readLaneRunState } from './lane-run-registry';

/**
 * What the Run tab shows for a lane: the scripts its repository declares
 * (listed before any ran — reading them asks nothing and approves nothing),
 * their run state, the lane's setup and its port block.
 */
export async function readLaneRunView(
  laneId: string
): Promise<Result<LaneRunView, { type: 'not_found' }>> {
  const row = findWorktreeRow(laneId);
  if (!row) return err({ type: 'not_found' as const });

  const base = {
    laneId,
    setupStatus: row.setupStatus as LaneSetupStatus | null,
    ports: { base: await ensureLanePortBlock(laneId), size: LANE_PORT_BLOCK_SIZE },
    runs: readLaneRunState(laneId),
  };
  try {
    const { config, repoId } = await resolveLaneBundle(laneId);
    return ok({
      ...base,
      repoId,
      scripts: Object.keys(config.scripts.run.value).map((id) => ({
        id,
        title: formatRunScriptRowTitle(id),
      })),
      hasTest: Boolean(config.scripts.test.value?.trim()),
      runMode: config.runMode.value,
      configError: null,
    });
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    return ok({
      ...base,
      // The empty state's link to Repo › Run & test needs the repository even then.
      repoId:
        db
          .select({ repoId: workItems.repoId })
          .from(workItems)
          .where(eq(workItems.id, row.workItemId))
          .limit(1)
          .all()[0]?.repoId ?? null,
      scripts: [],
      hasTest: false,
      runMode: null,
      configError: error.message,
    });
  }
}
