import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchOf,
  createSoloRepo,
  hashWorkingFiles,
  headOf,
  prepareLaneWork,
  readBytes,
  removeSoloRepo,
  soloBackupDir,
  soloRecordFile,
  soloRefsOf,
  statusOf,
  writeFile,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { readSoloState, recoverSoloOnBoot } from './solo-state';

describe('Solo state and boot recovery', () => {
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

  it('reads none for a root no lane holds', async () => {
    expect(await readSoloState(repo.root)).toEqual({ status: 'none' });
  });

  it('reads the record of the lane holding the root', async () => {
    await acquireLane();

    const state = await readSoloState(repo.root);

    expect(state.status).toBe('held');
    if (state.status === 'held') expect(state.record.laneId).toBe('lane-a');
  });

  it('reports none on boot when there is no record', async () => {
    expect(await recoverSoloOnBoot(repo.root)).toBe('none');
  });

  it('releases a leftover hold on boot when the root is unchanged', async () => {
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();

    expect(await recoverSoloOnBoot(repo.root)).toBe('released');

    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(statusOf(repo.root)).toBe('');
    expect(fs.existsSync(soloRecordFile(repo.root))).toBe(false);
    expect(fs.existsSync(soloBackupDir(repo.root))).toBe(false);
    expect(soloRefsOf(repo.root)).toEqual([]);
  });

  it('leaves a changed root held on boot and reports the changed files', async () => {
    prepareLaneWork(repo.lane);
    await acquireLane();
    writeFile(repo.root, 'README.md', '# edited in the root\n');

    expect(await recoverSoloOnBoot(repo.root)).toEqual({
      interrupted: { files: ['README.md'] },
    });

    expect(readBytes(repo.root, 'README.md').toString()).toBe('# edited in the root\n');
    expect((await readSoloState(repo.root)).status).toBe('held');
    expect(soloRefsOf(repo.root)).toEqual(['refs/chord/solo/lane-a']);
  });
});
