import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchOf,
  createSoloRepo,
  expectRootMatchesLane,
  git,
  hashWorkingFiles,
  headOf,
  prepareLaneWork,
  removeSoloRepo,
  stagedFilesOf,
  statusOf,
  writeFile,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { releaseSoloHost } from './release-solo-host';
import { readSoloState } from './solo-state';
import { syncSoloFromLane } from './sync-solo-from-lane';

describe('syncSoloFromLane', () => {
  let repo: SoloRepo;

  beforeEach(() => {
    repo = createSoloRepo();
  });

  afterEach(() => {
    removeSoloRepo(repo);
  });

  async function acquireLane(): Promise<void> {
    const result = await acquireSoloHost({
      rootPath: repo.root,
      laneId: 'lane-a',
      laneCheckoutPath: repo.lane,
    });
    if (!result.success) throw new Error(`acquire refused: ${JSON.stringify(result.error)}`);
  }

  /** A new lane commit that touches a file the acquire left alone, plus fresh uncommitted work. */
  function advanceLane(): void {
    writeFile(repo.lane, 'docs/other.md', 'Other\nnotes, revised in the lane\n');
    git(repo.lane, 'add', 'docs/other.md');
    git(repo.lane, 'commit', '-q', '-m', 'lane revises other.md');
    writeFile(repo.lane, 'src/feature.ts', 'export const feature = false;\n');
    writeFile(repo.lane, 'windows.txt', 'crlf line one\r\nedited in the lane\r\n');
    writeFile(repo.lane, 'notes/later.md', '- after sync\n');
  }

  it("applies the lane's new commit and edits over the root and updates the record", async () => {
    prepareLaneWork(repo.lane);
    await acquireLane();
    const first = await readSoloState(repo.root);
    if (first.status !== 'held') throw new Error('expected a held slot');
    advanceLane();

    const result = await syncSoloFromLane({ rootPath: repo.root });

    expect(result.success).toBe(true);
    expect(headOf(repo.root)).toBe(headOf(repo.lane));
    expect(branchOf(repo.root)).toBe('HEAD');
    expect(stagedFilesOf(repo.root)).toBe('');
    expect(statusOf(repo.root)).toBe(statusOf(repo.lane));
    expectRootMatchesLane(repo.root, repo.lane);

    const state = await readSoloState(repo.root);
    if (state.status !== 'held') throw new Error('expected a held slot');
    expect(state.record.laneHead).toBe(headOf(repo.lane));
    expect(state.record.snapshotCommit).not.toBe(first.record.snapshotCommit);
    expect(git(repo.root, 'rev-parse', 'refs/chord/solo/lane-a').trim()).toBe(
      state.record.snapshotCommit
    );
    expect(state.record.rootHead).toBe(first.record.rootHead);
    expect(state.record.rootBranch).toBe('main');
    if (result.success) expect(result.data).toEqual(state.record);
  });

  it('refuses when the root was edited during Solo, listing the files, and changes nothing', async () => {
    prepareLaneWork(repo.lane);
    await acquireLane();
    const first = await readSoloState(repo.root);
    writeFile(repo.root, 'README.md', '# edited in the root\n');
    advanceLane();
    const duringSolo = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);

    const result = await syncSoloFromLane({ rootPath: repo.root });

    expect(result).toEqual({
      success: false,
      error: { type: 'root_changed', files: ['README.md'] },
    });
    expect(hashWorkingFiles(repo.root)).toEqual(duringSolo);
    expect(headOf(repo.root)).toBe(head);
    expect(await readSoloState(repo.root)).toEqual(first);
  });

  it('still returns the root byte for byte after a sync touched files the acquire did not', async () => {
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();
    advanceLane();
    expect((await syncSoloFromLane({ rootPath: repo.root })).success).toBe(true);

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result.success).toBe(true);
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(statusOf(repo.root)).toBe('');
  });

  it('refuses when no lane holds the root', async () => {
    const result = await syncSoloFromLane({ rootPath: repo.root });

    expect(result).toEqual({ success: false, error: { type: 'solo_not_held' } });
  });
});
