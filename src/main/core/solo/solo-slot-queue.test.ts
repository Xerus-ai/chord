import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  git,
  insertRepoAndItems,
  neverAsk,
  removeLaneRepo,
  REPO_ID,
  samePath,
  type LaneRepo,
} from '@main/core/lane-runs/_testing/lane-run-fixture';
import { isRunning, runProcessOf } from '@main/core/lane-runs/_testing/run-process';
import { readLaneRunState, releaseLaneRuns } from '@main/core/lane-runs/lane-run-registry';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import {
  addSoloLane,
  createSoloLaneRepo,
  headOf,
  waitForRunMark,
  waitForTestMark,
} from './_testing/solo-slot-fixture';
import { readSoloView } from './read-solo-view';
import { releaseSolo } from './release-solo';
import { leaveSoloQueue, soloLane, syncSolo } from './solo-lane';
import { restartSoloRun, runSoloTest } from './solo-runs';

/**
 * The Solo slot beyond taking and handing it over: syncing the holder's new
 * work into the root without stopping its runs, leaving the queue, a queued
 * lane that can no longer take the slot (skipped and reported, never a stuck
 * queue), and Restart / Run tests acting on the Solo runs in the root. Same
 * substitutes as `solo-slot.test.ts`.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

const LANES = ['lane-a', 'lane-b', 'lane-c'] as const;
const [A, B, C] = LANES;

describe('the Solo slot while held', () => {
  let repo: LaneRepo;
  let root: string;
  const lanePaths: Record<string, string> = {};

  beforeEach(async () => {
    repo = await createSoloLaneRepo('solo-queue-');
    root = repo.repoDir;
    insertRepoAndItems(root, ['item-a', 'item-b', 'item-c']);
    for (const laneId of LANES) {
      const dir = laneId.slice('lane-'.length);
      lanePaths[laneId] = await addSoloLane(repo, { laneId, workItemId: `item-${dir}`, dir });
    }
  });

  afterEach(async () => {
    for (const laneId of LANES) await leaveSoloQueue(laneId);
    await releaseSolo({ repoId: REPO_ID }, { discardRootChanges: true }, neverAsk);
    for (const laneId of LANES) await releaseLaneRuns(laneId);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  async function holdWith(laneId: string) {
    const result = await soloLane(laneId, neverAsk);
    if (!result.success || result.data.status !== 'holding') {
      throw new Error(`${laneId} did not take the slot: ${JSON.stringify(result)}`);
    }
    const mark = await waitForRunMark(root, laneId);
    return { ...mark, process: await runProcessOf(mark.pid) };
  }

  it("Sync from lane applies the holder's new commit and edits to the root without stopping its runs", async () => {
    const mark = await holdWith(A);
    fs.writeFileSync(path.join(lanePaths[A], 'synced.md'), 'committed after Solo\n');
    await git(['add', 'synced.md'], lanePaths[A]);
    await git(['commit', '-m', 'more work'], lanePaths[A]);
    fs.writeFileSync(path.join(lanePaths[A], 'a.md'), 'edited, not committed\n');

    const synced = await syncSolo(A);

    expect(synced.success).toBe(true);
    expect(await headOf(root)).toBe(await headOf(lanePaths[A]));
    expect(fs.readFileSync(path.join(root, 'synced.md'), 'utf8')).toMatch(
      /^committed after Solo\r?\n$/
    );
    expect(fs.readFileSync(path.join(root, 'a.md'), 'utf8')).toMatch(
      /^edited, not committed\r?\n$/
    );
    expect(await isRunning(mark.process)).toBe(true);
    expect(readLaneRunState(A).scripts.app?.status).toBe('running');
  });

  it('refuses Sync for a lane that does not hold the slot', async () => {
    await holdWith(A);
    await soloLane(B, neverAsk);

    expect(await syncSolo(B)).toEqual({ success: false, error: { type: 'solo_not_held' } });
    expect(await syncSolo(C)).toEqual({ success: false, error: { type: 'solo_not_held' } });
  });

  it('Leave queue takes the lane out of line; leaving twice is refused; release then hands to nobody', async () => {
    await holdWith(A);
    await soloLane(B, neverAsk);
    await soloLane(C, neverAsk);

    expect((await leaveSoloQueue(B)).success).toBe(true);
    expect((await readSoloView(REPO_ID)).queue.map((entry) => entry.laneId)).toEqual([C]);
    expect(await soloLane(C, neverAsk)).toEqual({
      success: true,
      data: { status: 'queued', position: 1 },
    });
    expect(await leaveSoloQueue(B)).toEqual({ success: false, error: { type: 'not_queued' } });
    expect((await leaveSoloQueue(C)).success).toBe(true);

    const released = await releaseSolo({ laneId: A }, { discardRootChanges: false }, neverAsk);

    expect(released).toMatchObject({ success: true, data: { handedTo: null, skipped: [] } });
    expect(readLaneRunState(B).scripts).toEqual({});
    expect(readLaneRunState(C).scripts).toEqual({});
  });

  it('a queued lane that can no longer take the slot is skipped and reported, and the next one gets it', async () => {
    await holdWith(A);
    await soloLane(B, neverAsk);
    await soloLane(C, neverAsk);
    // B's checkout goes behind the app's back: its row stays, its folder does not.
    await git(['worktree', 'remove', '--force', lanePaths[B]], root);

    const released = await releaseSolo({ laneId: A }, { discardRootChanges: false }, neverAsk);

    expect(released).toMatchObject({
      success: true,
      data: {
        releasedLaneId: A,
        handedTo: { laneId: C, starts: [{ scriptId: 'app', error: null }] },
        skipped: [{ laneId: B, reason: expect.any(String) }],
      },
    });
    if (released.success) expect(released.data.skipped[0].reason.length).toBeGreaterThan(0);
    expect(await headOf(root)).toBe(await headOf(lanePaths[C]));
    expect((await waitForRunMark(root, C)).solo).toBe('1');
    expect(await readSoloView(REPO_ID)).toMatchObject({ holder: { laneId: C }, queue: [] });
  });

  it('Restart acts on the Solo run: a new process, still in the root', async () => {
    const first = await holdWith(A);

    const restarted = await restartSoloRun({ laneId: A, scriptId: 'app' }, neverAsk);

    expect(restarted.success).toBe(true);
    const second = await waitForRunMark(root, A, first.pid);
    expect(await isRunning(first.process)).toBe(false);
    expect(samePath(second.cwd, root)).toBe(true);
    expect(second.solo).toBe('1');
    expect(fs.existsSync(path.join(lanePaths[A], `solo-${A}.txt`))).toBe(false);
  });

  it("Run tests runs the holder's test in the root, where its stack runs", async () => {
    await holdWith(A);

    const started = await runSoloTest(A, neverAsk);

    expect(started.success).toBe(true);
    const mark = await waitForTestMark(root, A);
    expect(samePath(mark.cwd, root)).toBe(true);
    expect(mark.solo).toBe('1');
    await vi.waitFor(() => expect(readLaneRunState(A).test.status).toBe('passed'), {
      timeout: 15_000,
    });
  });

  it('Restart and Run tests in the root are refused to a lane that does not hold the slot', async () => {
    await holdWith(A);

    expect(await restartSoloRun({ laneId: B, scriptId: 'app' }, neverAsk)).toEqual({
      success: false,
      error: { type: 'solo_not_held' },
    });
    expect(await runSoloTest(B, neverAsk)).toEqual({
      success: false,
      error: { type: 'solo_not_held' },
    });
    expect(readLaneRunState(B).scripts).toEqual({});
  });
});
