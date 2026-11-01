import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { laneRunChangedChannel } from '@shared/events/laneRunEvents';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import {
  addLane,
  approveLaneAsIs,
  commitTeamConfig,
  createLaneRepo,
  insertRepoAndItems,
  isAlive,
  neverAsk,
  readLaneRow,
  removeLaneRepo,
  samePath,
  waitForPid,
  type LaneRepo,
} from './_testing/lane-run-fixture';
import {
  readLaneRunState,
  releaseLaneRuns,
  stopEveryLaneRun,
  stopLaneRun,
} from './lane-run-registry';
import { restartLaneRun, startLaneRun } from './start-lane-run';

/**
 * The run engine against real processes in real lanes: each run script is
 * its own PTY process in the lane's checkout, with the lane's env; Stop is
 * Ctrl+C first and a tree kill only after the grace period (plan §Phase 4,
 * Processes; S3). Only the database (a migrated test DB) and the IPC emitter
 * are substituted — the emitter needs Electron's main process, and what it
 * would announce is captured here.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const emitted = vi.hoisted(() => [] as { channel: string; payload: unknown }[]);
vi.mock('@main/lib/events', () => ({
  events: {
    emit: (channel: { name: string }, payload: unknown) =>
      emitted.push({ channel: channel.name, payload }),
    // Main's adapter only hears what the renderer sends; nothing does here.
    on: () => () => {},
    once: () => () => {},
  },
}));

const ITEM_ID = 'item-1';
const SECOND_ITEM_ID = 'item-2';
const LANE_ID = 'lane-1';
const SECOND_LANE_ID = 'lane-2';

const TEAM_CONFIG = {
  scripts: {
    run: {
      web: 'node scripts/serve.cjs',
      env: 'node scripts/env.cjs',
      stubborn: 'node scripts/stubborn.cjs',
      // Quotes and spaces, as people write them: run as the setup shell would.
      quoted: `node -e "require('fs').writeFileSync('quoted.txt', 'ran as written')"`,
    },
    test: 'node scripts/exit.cjs 0',
  },
};

describe('lane runs', () => {
  let repo: LaneRepo;
  let lanePath: string;

  const scriptState = (scriptId: string, laneId = LANE_ID) =>
    readLaneRunState(laneId).scripts[scriptId];

  beforeEach(async () => {
    emitted.length = 0;
    repo = await createLaneRepo('lane-runs-');
    await commitTeamConfig(repo.repoDir, TEAM_CONFIG);
    insertRepoAndItems(repo.repoDir, [ITEM_ID, SECOND_ITEM_ID]);
    lanePath = await addLane({ repo, laneId: LANE_ID, workItemId: ITEM_ID, dir: 'lane' });
    await approveLaneAsIs(LANE_ID);
  });

  afterEach(async () => {
    await releaseLaneRuns(LANE_ID);
    await releaseLaneRuns(SECOND_LANE_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  it("runs a script in the lane's checkout with the lane's env, and records its exit", async () => {
    const started = await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk);

    expect(started.success).toBe(true);
    await vi.waitFor(() => expect(scriptState('env')?.status).toBe('exited'), { timeout: 15_000 });
    expect(scriptState('env')).toMatchObject({ exitCode: 0, url: null });
    expect(scriptState('env')?.ptySessionId).toEqual(expect.any(String));
    const seen = JSON.parse(fs.readFileSync(path.join(lanePath, 'run-env.json'), 'utf8'));
    expect(seen.port).toBe(String(readLaneRow(LANE_ID).portBase));
    expect(seen.laneId).toBe(LANE_ID);
    expect(samePath(seen.cwd, lanePath)).toBe(true);
    // Every change is announced, keyed by lane.
    expect(emitted).toContainEqual({
      channel: laneRunChangedChannel.name,
      payload: expect.objectContaining({ laneId: LANE_ID }),
    });
  });

  it('runs a command with quotes and spaces as written, as the setup shell does', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'quoted' }, neverAsk);

    await vi.waitFor(() => expect(scriptState('quoted')?.status).toBe('exited'), {
      timeout: 15_000,
    });
    expect(scriptState('quoted')?.exitCode).toBe(0);
    expect(fs.readFileSync(path.join(lanePath, 'quoted.txt'), 'utf8')).toBe('ran as written');
  });

  it('shows the URL the dev server prints, and it serves', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    const port = readLaneRow(LANE_ID).portBase;

    await vi.waitFor(() => expect(scriptState('web')?.url).toBe(`http://localhost:${port}`), {
      timeout: 15_000,
    });
    expect(scriptState('web')?.status).toBe('running');
    expect(await (await fetch(`http://localhost:${port}`)).text()).toBe('served');
  });

  it('stops a script with Ctrl+C first, so one that handles it exits gracefully', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    const pid = await waitForPid(path.join(lanePath, 'serve.pid'));

    const t0 = Date.now();
    const stopped = await stopLaneRun(LANE_ID, 'web');

    expect(Date.now() - t0).toBeLessThan(9_000);
    expect(stopped.scripts.web.status).toBe('stopped');
    expect(fs.readFileSync(path.join(lanePath, 'graceful.txt'), 'utf8')).toBe('stopped on Ctrl+C');
    expect(isAlive(pid)).toBe(false);
    expect(scriptState('web')).toMatchObject({ status: 'stopped', url: null });
  });

  it('tree-kills a script that ignores Ctrl+C once the grace period is over', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'stubborn' }, neverAsk);
    const pid = await waitForPid(path.join(lanePath, 'stubborn.pid'));

    const t0 = Date.now();
    const stopping = stopLaneRun(LANE_ID, 'stubborn');
    await vi.waitFor(() => expect(scriptState('stubborn')?.status).toBe('stopping'));
    await stopping;

    // It was asked first (Ctrl+C reached it), and killed only after waiting.
    expect(fs.existsSync(path.join(lanePath, 'sigint-seen.txt'))).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(9_500);
    expect(isAlive(pid)).toBe(false);
    expect(scriptState('stubborn')?.status).toBe('stopped');
  });

  it('refuses to start a script that is already running', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    const pid = await waitForPid(path.join(lanePath, 'serve.pid'));

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'already_running' },
    });
    expect(isAlive(pid)).toBe(true);
  });

  it('restarts a running script: the old process goes, a new one runs', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    const first = await waitForPid(path.join(lanePath, 'serve.pid'));
    fs.rmSync(path.join(lanePath, 'serve.pid'));

    const restarted = await restartLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);

    expect(restarted.success).toBe(true);
    const second = await waitForPid(path.join(lanePath, 'serve.pid'));
    expect(second).not.toBe(first);
    expect(isAlive(first)).toBe(false);
    expect(scriptState('web')?.status).toBe('running');
  });

  it('says no_script for a run script the repository does not declare', async () => {
    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'nope' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'no_script' },
    });
  });

  it.each(['pending', 'running'] as const)(
    'says setup_running while setup is %s (dependencies may be missing)',
    async (setupStatus) => {
      db.update(workItemWorktrees)
        .set({ setupStatus })
        .where(eq(workItemWorktrees.id, LANE_ID))
        .run();

      expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk)).toEqual({
        success: false,
        error: { type: 'setup_running' },
      });
      expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(false);
    }
  );

  it('says checkout_missing when the lane has no checkout on disk', async () => {
    db.update(workItemWorktrees)
      .set({ path: path.join(repo.root, 'pool', 'gone') })
      .where(eq(workItemWorktrees.id, LANE_ID))
      .run();

    expect(await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'checkout_missing' },
    });
  });

  it('says not_found for a lane that does not exist', async () => {
    expect(await startLaneRun({ laneId: 'no-such-lane', scriptId: 'env' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'not_found' },
    });
  });

  it('runs in a host directory with extra env when asked to, keeping the state on the lane', async () => {
    // Solo (slice 4): the lane's scripts run in the repository's root checkout.
    const started = await startLaneRun(
      {
        laneId: LANE_ID,
        scriptId: 'env',
        host: { cwd: repo.repoDir, extraEnv: { CHORD_SOLO: '1' } },
      },
      neverAsk
    );

    expect(started.success).toBe(true);
    await vi.waitFor(() => expect(scriptState('env')?.status).toBe('exited'), { timeout: 15_000 });
    const seen = JSON.parse(fs.readFileSync(path.join(repo.repoDir, 'run-env.json'), 'utf8'));
    expect(seen).toMatchObject({ solo: '1', laneId: LANE_ID });
    expect(seen.port).toBe(String(readLaneRow(LANE_ID).portBase));
    expect(samePath(seen.cwd, repo.repoDir)).toBe(true);
    expect(fs.existsSync(path.join(lanePath, 'run-env.json'))).toBe(false);
  });

  it('stops every run of every lane at once (app quit)', async () => {
    const secondPath = await addLane({
      repo,
      laneId: SECOND_LANE_ID,
      workItemId: SECOND_ITEM_ID,
      dir: 'second',
    });
    await approveLaneAsIs(SECOND_LANE_ID);
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    await startLaneRun({ laneId: SECOND_LANE_ID, scriptId: 'web' }, neverAsk);
    const pids = [
      await waitForPid(path.join(lanePath, 'serve.pid')),
      await waitForPid(path.join(secondPath, 'serve.pid')),
    ];

    await stopEveryLaneRun();

    expect(pids.filter(isAlive)).toEqual([]);
    expect(scriptState('web')?.status).toBe('stopped');
    expect(scriptState('web', SECOND_LANE_ID)?.status).toBe('stopped');
  });
});
