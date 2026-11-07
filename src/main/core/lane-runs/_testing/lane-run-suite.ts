import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import { releaseLaneRuns } from '../lane-run-registry';
import { removeLaneRepo, type LaneRepo } from './lane-run-fixture';

/**
 * The end of every run-engine test: the lanes' runs released (real processes
 * stopped), the app's rows deleted from the suite's migrated test DB, and the
 * repository's folder removed once its processes let go.
 */
export async function tearDownLaneRepo(repo: LaneRepo, laneIds: readonly string[]): Promise<void> {
  for (const laneId of laneIds) await releaseLaneRuns(laneId);
  db.delete(workItems).run();
  db.delete(repos).run();
  await removeLaneRepo(repo);
}
