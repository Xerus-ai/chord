import { afterEach, beforeEach, expect } from 'vitest';
import {
  insertRepoAndItems,
  neverAsk,
  REPO_ID,
  type LaneRepo,
} from '@main/core/lane-runs/_testing/lane-run-fixture';
import { tearDownLaneRepo } from '@main/core/lane-runs/_testing/lane-run-suite';
import { runProcessOf, type RunProcess } from '@main/core/lane-runs/_testing/run-process';
import { releaseSolo } from '../release-solo';
import { leaveSoloQueue, soloLane } from '../solo-lane';
import {
  addSoloLane,
  branchOf,
  createSoloLaneRepo,
  hashRootFiles,
  headOf,
  statusOf,
  waitForRunMark,
  type SoloRunMark,
} from './solo-slot-fixture';

/**
 * One Solo-mode repository per test for the Solo slot's suites: its work
 * items, its lanes (real `git worktree`s, approved), and after the test every
 * lane out of the queue, the slot released with the root's changes discarded,
 * every run stopped and the repository removed.
 */

export interface SoloLaneSpec {
  laneId: string;
  workItemId: string;
  dir: string;
  isPrimary?: boolean;
}

export interface SoloSuite {
  repo: LaneRepo;
  root: string;
  lanePaths: Record<string, string>;
}

/** lane-a on item-a in pool/a, and so on: one primary lane per work item. */
export function lanesPerItem(laneIds: readonly string[]): SoloLaneSpec[] {
  return laneIds.map((laneId) => {
    const dir = laneId.slice('lane-'.length);
    return { laneId, workItemId: `item-${dir}`, dir };
  });
}

/**
 * Registers the suite's beforeEach and afterEach. `alsoLeaving`: lanes some
 * tests add themselves, cleaned up the same way.
 */
export function useSoloSuite(
  prefix: string,
  lanes: readonly SoloLaneSpec[],
  alsoLeaving: readonly string[] = []
): SoloSuite {
  const suite = { lanePaths: {} } as SoloSuite;
  const laneIds = [...lanes.map((lane) => lane.laneId), ...alsoLeaving];
  beforeEach(async () => {
    suite.repo = await createSoloLaneRepo(prefix);
    suite.root = suite.repo.repoDir;
    insertRepoAndItems(suite.root, [...new Set(lanes.map((lane) => lane.workItemId))]);
    for (const lane of lanes) suite.lanePaths[lane.laneId] = await addSoloLane(suite.repo, lane);
  });
  afterEach(async () => {
    for (const laneId of laneIds) await leaveSoloQueue(laneId);
    await releaseSolo({ repoId: REPO_ID }, { discardRootChanges: true }, neverAsk);
    await tearDownLaneRepo(suite.repo, laneIds);
  });
  return suite;
}

/** The lane takes the free slot; its run's mark in the root and its process. */
export async function holdSoloSlot(
  root: string,
  laneId: string
): Promise<SoloRunMark & { process: RunProcess }> {
  const result = await soloLane(laneId, neverAsk);
  if (!result.success || result.data.status !== 'holding') {
    throw new Error(`${laneId} did not take the slot: ${JSON.stringify(result)}`);
  }
  const mark = await waitForRunMark(root, laneId);
  return { ...mark, process: await runProcessOf(mark.pid) };
}

/** The root is back as it was before Solo: its files, `main` at `head`, nothing changed. */
export async function expectRootReturned(
  root: string,
  before: Record<string, string>,
  head: string
): Promise<void> {
  expect(hashRootFiles(root)).toEqual(before);
  expect(await headOf(root)).toBe(head);
  expect(await branchOf(root)).toBe('main');
  expect(await statusOf(root)).toBe('');
}
