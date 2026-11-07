import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { soloChangedChannel } from '@shared/events/soloEvents';
import {
  answer,
  commitTeamConfig,
  neverAsk,
  REPO_ID,
  samePath,
} from '@main/core/lane-runs/_testing/lane-run-fixture';
import { isRunning } from '@main/core/lane-runs/_testing/run-process';
import { readLaneRunState } from '@main/core/lane-runs/lane-run-registry';
import { emitted } from '@main/lib/_stand-ins/renderer-events';
import {
  addSoloLane,
  branchOf,
  hashRootFiles,
  headOf,
  sawCtrlC,
  SOLO_TEAM_CONFIG,
  waitForRunMark,
} from './_testing/solo-slot-fixture';
import {
  expectRootReturned,
  holdSoloSlot,
  lanesPerItem,
  useSoloSuite,
} from './_testing/solo-slot-suite';
import { readSoloView } from './read-solo-view';
import { releaseSolo } from './release-solo';
import { soloLane } from './solo-lane';
import { readSoloState } from './solo-state';

/**
 * The Solo slot (plan §"Decisions for Phase 4", Slot + queue): one lane per
 * repository holds the root checkout and runs its run scripts there with
 * CHORD_SOLO=1; the others queue, first in first out; release stops the
 * holder's runs, returns the root and hands the slot to the next lane. Real
 * repository, real lanes, real processes; only the database (a migrated test
 * DB) and the IPC emitter (captured) are substituted, as in the run engine's
 * suites.
 */
vi.mock('@main/db/client', () => import('@main/db/_testing/test-db-client'));

vi.mock('@main/lib/events', () => import('@main/lib/_stand-ins/renderer-events'));

const LANES = ['lane-a', 'lane-b', 'lane-c'] as const;
const [A, B, C] = LANES;
/** A lane some tests add, approved or not as the test needs. */
const D = 'lane-d';

describe('the Solo slot', () => {
  const suite = useSoloSuite('solo-slot-', lanesPerItem(LANES), [D]);
  const { lanePaths } = suite;
  let root: string;
  beforeEach(() => {
    emitted.length = 0;
    root = suite.root;
  });
  const holdWith = (laneId: string) => holdSoloSlot(root, laneId);
  /** D on item-a beside lane-a, not approved: Solo asks about its scripts. */
  const addUnapprovedD = () =>
    addSoloLane(suite.repo, {
      laneId: D,
      workItemId: 'item-a',
      dir: 'd',
      isPrimary: false,
      approve: false,
    });

  it("refuses not_solo_mode when the repository's run mode is perWorktree, touching nothing", async () => {
    await commitTeamConfig(root, { ...SOLO_TEAM_CONFIG, runMode: 'perWorktree' });
    const head = await headOf(root);

    const result = await soloLane(A, neverAsk);

    expect(result).toEqual({ success: false, error: { type: 'not_solo_mode' } });
    expect(await headOf(root)).toBe(head);
    expect(await branchOf(root)).toBe('main');
    expect((await readSoloState(root)).status).toBe('none');
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, queue: [] });
  });

  it("puts the first lane in the root and runs its run script there, with CHORD_SOLO=1 and the root's path", async () => {
    const result = await soloLane(A, neverAsk);

    expect(result).toEqual({
      success: true,
      data: { status: 'holding', starts: [{ scriptId: 'app', error: null }] },
    });
    const mark = await waitForRunMark(root, A);
    expect(samePath(mark.cwd, root)).toBe(true);
    expect(mark.solo).toBe('1');
    expect(samePath(mark.rootPath!, root)).toBe(true);
    expect(mark.laneId).toBe(A);
    expect(await headOf(root)).toBe(await headOf(lanePaths[A]));
    expect(await branchOf(root)).toBe('HEAD');
    expect(fs.existsSync(path.join(root, 'a.md'))).toBe(true);
    // The run state is the lane's, as for any run.
    expect(readLaneRunState(A).scripts.app?.status).toBe('running');

    const view = await readSoloView(REPO_ID);
    expect(view).toMatchObject({
      repoId: REPO_ID,
      holder: { laneId: A, workItemId: 'item-a', workItemName: 'item-a', branch: 'chord/a' },
      queue: [],
      interrupted: null,
    });
    expect(samePath(view.rootPath, root)).toBe(true);
    expect(Number.isNaN(Date.parse(view.holder!.since))).toBe(false);
    expect(emitted).toContainEqual({
      channel: soloChangedChannel.name,
      payload: expect.objectContaining({
        repoId: REPO_ID,
        holder: expect.objectContaining({ laneId: A }),
      }),
    });
  });

  it('queues the next lanes behind the holder in order, and a second join adds no entry', async () => {
    await holdWith(A);

    expect(await soloLane(B, neverAsk)).toEqual({
      success: true,
      data: { status: 'queued', position: 1 },
    });
    expect(await soloLane(C, neverAsk)).toEqual({
      success: true,
      data: { status: 'queued', position: 2 },
    });
    expect(await soloLane(B, neverAsk)).toEqual({
      success: true,
      data: { status: 'queued', position: 1 },
    });

    const view = await readSoloView(REPO_ID);
    expect(view.holder?.laneId).toBe(A);
    expect(view.queue.map((entry) => entry.laneId)).toEqual([B, C]);
    expect(view.queue[0]).toMatchObject({ workItemId: 'item-b', branch: 'chord/b' });
    expect(readLaneRunState(B).scripts).toEqual({});
    expect(await headOf(root)).toBe(await headOf(lanePaths[A]));
  });

  it("release stops the holder's runs and hands the root to the next lane, whose runs start there on its HEAD", async () => {
    const first = await holdWith(A);
    await soloLane(B, neverAsk);

    const released = await releaseSolo({ laneId: A }, { discardRootChanges: false }, neverAsk);

    expect(released).toEqual({
      success: true,
      data: {
        releasedLaneId: A,
        leftovers: null,
        handedTo: { laneId: B, starts: [{ scriptId: 'app', error: null }] },
        skipped: [],
      },
    });
    expect(sawCtrlC(root, A)).toBe(true);
    expect(await isRunning(first.process)).toBe(false);
    expect(readLaneRunState(A).scripts.app?.status).toBe('stopped');
    const second = await waitForRunMark(root, B);
    expect(samePath(second.cwd, root)).toBe(true);
    expect(second.solo).toBe('1');
    expect(await headOf(root)).toBe(await headOf(lanePaths[B]));
    expect(fs.existsSync(path.join(root, 'b.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'a.md'))).toBe(false);
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: { laneId: B }, queue: [] });
  });

  it('release with nobody queued returns the root to its branch byte for byte', async () => {
    const before = hashRootFiles(root);
    const head = await headOf(root);
    await holdWith(A);

    const released = await releaseSolo(
      { repoId: REPO_ID },
      { discardRootChanges: false },
      neverAsk
    );

    expect(released).toMatchObject({ success: true, data: { releasedLaneId: A, handedTo: null } });
    await expectRootReturned(root, before, head);
    expect((await readSoloState(root)).status).toBe('none');
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, queue: [] });
  });

  it('refuses root_changed when the root was edited during Solo: the hold, the queue and the runs stay', async () => {
    const mark = await holdWith(A);
    await soloLane(B, neverAsk);
    fs.writeFileSync(path.join(root, 'scratch.md'), 'edited in the root\n');

    const released = await releaseSolo(
      { repoId: REPO_ID },
      { discardRootChanges: false },
      neverAsk
    );

    expect(released).toEqual({
      success: false,
      error: { type: 'root_changed', files: ['scratch.md'] },
    });
    expect(await isRunning(mark.process)).toBe(true);
    expect(readLaneRunState(A).scripts.app?.status).toBe('running');
    expect((await readSoloState(root)).status).toBe('held');
    expect(await readSoloView(REPO_ID)).toMatchObject({
      holder: { laneId: A },
      queue: [{ laneId: B }],
    });
    expect(fs.readFileSync(path.join(root, 'scratch.md'), 'utf8')).toBe('edited in the root\n');
  });

  it('Discard and release drops the root edits and returns the root byte for byte', async () => {
    const before = hashRootFiles(root);
    const head = await headOf(root);
    await holdWith(A);
    fs.writeFileSync(path.join(root, 'scratch.md'), 'edited in the root\n');

    const released = await releaseSolo({ laneId: A }, { discardRootChanges: true }, neverAsk);

    expect(released.success).toBe(true);
    await expectRootReturned(root, before, head);
  });

  it('refuses a dirty root with its files, and the lane does not join any queue', async () => {
    fs.writeFileSync(path.join(root, 'dirty.md'), 'uncommitted\n');

    const result = await soloLane(A, neverAsk);

    expect(result).toEqual({ success: false, error: { type: 'root_dirty', files: ['dirty.md'] } });
    expect(await branchOf(root)).toBe('main');
    expect(readLaneRunState(A).scripts).toEqual({});
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, queue: [] });
  });

  it("asks about the lane's scripts before the root is touched: Don't run leaves the root and the queue alone", async () => {
    await addUnapprovedD();
    const head = await headOf(root);
    const { ask, asked } = answer('dont-run');

    const result = await soloLane(D, ask);

    expect(result).toEqual({ success: false, error: { type: 'declined' } });
    expect(asked).toHaveLength(1);
    expect(await headOf(root)).toBe(head);
    expect((await readSoloState(root)).status).toBe('none');
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, queue: [] });
  });

  it('asks a lane that queues at the time it queues, so the hand-over runs without asking', async () => {
    await addUnapprovedD();
    await holdWith(A);
    const { ask, asked } = answer('run');

    expect(await soloLane(D, ask)).toEqual({
      success: true,
      data: { status: 'queued', position: 1 },
    });
    expect(asked).toHaveLength(1);

    const released = await releaseSolo({ laneId: A }, { discardRootChanges: false }, neverAsk);

    expect(released).toMatchObject({ success: true, data: { handedTo: { laneId: D } } });
    expect((await waitForRunMark(root, D)).solo).toBe('1');
  });
});
