import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import {
  addLane,
  commitTeamConfig,
  createLaneRepo,
  insertRepoAndItems,
  neverAsk,
  removeLaneRepo,
  type LaneRepo,
} from './_testing/lane-run-fixture';
import { readLaneRunState, releaseLaneRuns } from './lane-run-registry';
import { runLaneTest, startLaneRun } from './start-lane-run';

/**
 * The order of a start's checks: what was asked for is validated first. An
 * unknown script id, or a kind of script the repository does not declare,
 * is `no_script` whatever state the lane is in — saying "setup is still
 * running" for a script that does not exist sends the user to wait for
 * nothing (found by the run-and-test e2e). Only a real script then waits
 * for setup. Nothing is asked or spawned either way. Same substitutes as the
 * other run engine suites.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

const ITEM_ID = 'item-1';
const LANE_ID = 'lane-1';

describe('the checks before a start', () => {
  let repo: LaneRepo;

  beforeEach(async () => {
    repo = await createLaneRepo('lane-runs-start-checks-');
    insertRepoAndItems(repo.repoDir, [ITEM_ID]);
  });

  afterEach(async () => {
    await releaseLaneRuns(LANE_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  async function addLaneWithSetup(setupStatus: 'pending' | 'running'): Promise<void> {
    await addLane({ repo, laneId: LANE_ID, workItemId: ITEM_ID, dir: 'lane', setupStatus });
  }

  it('refuses an unknown script id with no_script while setup is pending', async () => {
    await commitTeamConfig(repo.repoDir, { scripts: { run: { web: 'node scripts/serve.cjs' } } });
    await addLaneWithSetup('pending');

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'nope' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'no_script' },
    });
    expect(readLaneRunState(LANE_ID).scripts).toEqual({});
  });

  it('refuses a repository with no run scripts with no_script while setup runs', async () => {
    await commitTeamConfig(repo.repoDir, { scripts: { setup: 'node scripts/exit.cjs 0' } });
    await addLaneWithSetup('running');

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'default' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'no_script' },
    });
    expect(await runLaneTest({ laneId: LANE_ID }, neverAsk)).toEqual({
      success: false,
      error: { type: 'no_script' },
    });
  });

  it('still makes a script that exists wait for setup, before asking anything', async () => {
    await commitTeamConfig(repo.repoDir, {
      scripts: { run: { web: 'node scripts/serve.cjs' }, test: 'node scripts/exit.cjs 0' },
    });
    await addLaneWithSetup('pending');

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'setup_running' },
    });
    expect(await runLaneTest({ laneId: LANE_ID }, neverAsk)).toEqual({
      success: false,
      error: { type: 'setup_running' },
    });
    expect(readLaneRunState(LANE_ID).scripts).toEqual({});
  });
});
