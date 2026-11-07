import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANE_PORT_BLOCK_SIZE } from '@main/core/worktrees/lane-env';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import {
  addLane,
  answer,
  approveLaneAsIs,
  commitTeamConfig,
  createLaneRepo,
  insertRepoAndItems,
  neverAsk,
  readLaneRow,
  removeLaneRepo,
  setJustMeScripts,
  waitForRunProcess,
  type LaneRepo,
} from './_testing/lane-run-fixture';
import { isRunning } from './_testing/run-process';
import { readLaneRunState, releaseLaneRuns, stopLaneTest } from './lane-run-registry';
import { readLaneRunView } from './read-lane-run-view';
import { runLaneTest, startLaneRun } from './start-lane-run';

/**
 * Test runs (pass/fail from the exit code, with duration and log), what the
 * Run tab reads, and the trust rule for Start and Run tests: an unapproved
 * team script is put to the user every time they press the button, and
 * their own (just-me) scripts never are. Real processes, real lanes, real
 * approvals; only the database and the IPC emitter are substituted.
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

describe('lane test runs and the Run tab', () => {
  let repo: LaneRepo;
  let lanePath: string;

  const testState = () => readLaneRunState(LANE_ID).test;

  async function createLane(config: object): Promise<void> {
    await commitTeamConfig(repo.repoDir, config);
    lanePath = await addLane({ repo, laneId: LANE_ID, workItemId: ITEM_ID, dir: 'lane' });
  }

  beforeEach(async () => {
    repo = await createLaneRepo('lane-test-runs-');
    insertRepoAndItems(repo.repoDir, [ITEM_ID]);
  });

  afterEach(async () => {
    await releaseLaneRuns(LANE_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  it('reports a test that exits 0 as passed, with its duration', async () => {
    await createLane({ scripts: { test: 'node scripts/exit.cjs 0' } });
    await approveLaneAsIs(LANE_ID);

    const started = await runLaneTest({ laneId: LANE_ID }, neverAsk);

    expect(started.success).toBe(true);
    expect(testState().status).toBe('running');
    await vi.waitFor(() => expect(testState().status).toBe('passed'), { timeout: 15_000 });
    const test = testState();
    expect(test.exitCode).toBe(0);
    expect(test.durationMs).toBeGreaterThanOrEqual(250);
    expect(test.finishedAt).toBeGreaterThanOrEqual(test.startedAt ?? Infinity);
    expect(test.ptySessionId).toEqual(expect.any(String));
  });

  it("reports a failing test with its exit code — the user's own test script, run without asking", async () => {
    await createLane({ scripts: { test: 'node scripts/exit.cjs 0' } });
    setJustMeScripts({ test: 'node scripts/exit.cjs 1' });

    await runLaneTest({ laneId: LANE_ID }, neverAsk);

    await vi.waitFor(() => expect(testState().status).toBe('failed'), { timeout: 15_000 });
    expect(testState()).toMatchObject({ exitCode: 1 });
    expect(testState().durationMs).toBeGreaterThanOrEqual(250);
  });

  it('says no_script when the repository has no test script', async () => {
    await createLane({ scripts: { run: 'node scripts/serve.cjs' } });
    await approveLaneAsIs(LANE_ID);

    expect(await runLaneTest({ laneId: LANE_ID }, neverAsk)).toEqual({
      success: false,
      error: { type: 'no_script' },
    });
    expect(testState().status).toBe('idle');
  });

  it('refuses a second test run while one is running, and Stop ends it as stopped, not failed', async () => {
    await createLane({ scripts: { test: 'node scripts/serve.cjs' } });
    await approveLaneAsIs(LANE_ID);
    await runLaneTest({ laneId: LANE_ID }, neverAsk);
    const run = await waitForRunProcess(path.join(lanePath, 'serve.pid'));

    expect(await runLaneTest({ laneId: LANE_ID }, neverAsk)).toEqual({
      success: false,
      error: { type: 'already_running' },
    });

    const after = await stopLaneTest(LANE_ID);

    // The user ended it: that says nothing about whether the tests pass.
    expect(after.test).toMatchObject({ status: 'stopped', exitCode: expect.any(Number) });
    expect(after.test.durationMs).toBeGreaterThanOrEqual(0);
    expect(after.test.finishedAt).toBeGreaterThanOrEqual(after.test.startedAt ?? Infinity);
    expect(await isRunning(run)).toBe(false);
  });

  it("asks about the team's unapproved script on Start; Don't run declines and runs nothing", async () => {
    await createLane({ scripts: { run: { env: 'node scripts/env.cjs' } } });
    const declined = answer('dont-run');

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, declined.ask)).toEqual({
      success: false,
      error: { type: 'declined' },
    });
    expect(declined.asked).toHaveLength(1);
    expect(declined.asked[0].bundle.content.chord.run).toEqual({ env: 'node scripts/env.cjs' });
    expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(false);

    // Pressing Start again is the user asking to run it: they are asked again.
    const approved = answer('run');
    expect((await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, approved.ask)).success).toBe(
      true
    );
    expect(approved.asked).toHaveLength(1);
    await vi.waitFor(() => expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(true), {
      timeout: 15_000,
    });
  });

  it("asks about the team's unapproved test script on Run tests", async () => {
    await createLane({ scripts: { test: 'node scripts/exit.cjs 0' } });
    const declined = answer('dont-run');

    expect(await runLaneTest({ laneId: LANE_ID }, declined.ask)).toEqual({
      success: false,
      error: { type: 'declined' },
    });
    expect(declined.asked).toHaveLength(1);
    expect(testState().status).toBe('idle');
  });

  it("runs the user's own run script without asking, in place of the team's", async () => {
    await createLane({ scripts: { run: { env: 'node scripts/serve.cjs' } } });
    setJustMeScripts({ run: { env: 'node scripts/env.cjs' } });

    expect((await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk)).success).toBe(true);
    await vi.waitFor(() => expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(true), {
      timeout: 15_000,
    });
  });

  it('lists the configured scripts before any ran, with the port block and setup status', async () => {
    await createLane({
      scripts: {
        run: { web: 'node scripts/serve.cjs', worker: 'node scripts/env.cjs' },
        test: 'x',
      },
    });

    const view = await readLaneRunView(LANE_ID);

    expect(view.success).toBe(true);
    if (!view.success) return;
    expect(view.data.repoId).toBe('repo-1');
    expect(view.data.scripts).toEqual([
      { id: 'web', title: 'web' },
      { id: 'worker', title: 'worker' },
    ]);
    expect(view.data.hasTest).toBe(true);
    expect(view.data.runMode).toBe('perWorktree');
    expect(view.data.setupStatus).toBe('ok');
    expect(view.data.ports).toEqual({
      base: readLaneRow(LANE_ID).portBase,
      size: LANE_PORT_BLOCK_SIZE,
    });
    expect(view.data.runs).toEqual({
      laneId: LANE_ID,
      scripts: {},
      test: expect.objectContaining({ status: 'idle' }),
    });
  });

  it('shows the string-form run script as the one default script, and no scripts when none', async () => {
    await createLane({ scripts: { run: 'node scripts/serve.cjs' } });

    const view = await readLaneRunView(LANE_ID);
    expect(view.success && view.data.scripts).toEqual([{ id: 'default', title: 'Run' }]);
    expect(view.success && view.data.hasTest).toBe(false);

    expect(await readLaneRunView('no-such-lane')).toEqual({
      success: false,
      error: { type: 'not_found' },
    });
  });
});
