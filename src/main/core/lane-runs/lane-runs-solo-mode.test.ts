import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import {
  addLane,
  approveLaneAsIs,
  commitTeamConfig,
  createLaneRepo,
  insertRepoAndItems,
  neverAsk,
  removeLaneRepo,
  samePath,
  type LaneRepo,
} from './_testing/lane-run-fixture';
import { readLaneRunState, releaseLaneRuns } from './lane-run-registry';
import { restartLaneRun, runLaneTest, startLaneRun } from './start-lane-run';

/**
 * In a repository whose run mode is `solo` the app runs once, from the root
 * checkout (plan §"Decisions for Phase 4", Solo host): a lane's run scripts
 * start only through the Solo layer, which passes the root as the host. A
 * Start or Restart in the lane's own checkout is refused with `solo_mode`
 * before anything is asked or spawned. Tests stay per lane: agents run them
 * in parallel and they rarely need the fixed ports a stack binds. Same
 * substitutes as the other run engine suites.
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

describe('lane runs in a Solo-mode repository', () => {
  let repo: LaneRepo;
  let lanePath: string;

  beforeEach(async () => {
    repo = await createLaneRepo('lane-runs-solo-mode-');
    await commitTeamConfig(repo.repoDir, {
      runMode: 'solo',
      scripts: { run: { env: 'node scripts/env.cjs' }, test: 'node scripts/exit.cjs 0' },
    });
    insertRepoAndItems(repo.repoDir, [ITEM_ID]);
    lanePath = await addLane({ repo, laneId: LANE_ID, workItemId: ITEM_ID, dir: 'lane' });
  });

  afterEach(async () => {
    await releaseLaneRuns(LANE_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  it('refuses Start and Restart in the lane checkout with solo_mode, before asking anything', async () => {
    // Unapproved, and `neverAsk` fails if asked: the refusal comes first.
    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'solo_mode' },
    });
    expect(await restartLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'solo_mode' },
    });
    expect(readLaneRunState(LANE_ID).scripts).toEqual({});
    expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(false);
  });

  it('starts a run script given a host, as the Solo layer does', async () => {
    await approveLaneAsIs(LANE_ID);

    const started = await startLaneRun(
      { laneId: LANE_ID, scriptId: 'env', host: { cwd: lanePath, extraEnv: { CHORD_SOLO: '1' } } },
      neverAsk
    );

    expect(started.success).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(true), {
      timeout: 15_000,
    });
    const seen = JSON.parse(fs.readFileSync(path.join(lanePath, 'run-env.json'), 'utf8'));
    expect(seen.solo).toBe('1');
    expect(samePath(seen.cwd, lanePath)).toBe(true);
  });

  it('still runs the test in the lane checkout', async () => {
    await approveLaneAsIs(LANE_ID);

    const started = await runLaneTest({ laneId: LANE_ID }, neverAsk);

    expect(started.success).toBe(true);
    await vi.waitFor(() => expect(readLaneRunState(LANE_ID).test.status).toBe('passed'), {
      timeout: 15_000,
    });
  });
});
