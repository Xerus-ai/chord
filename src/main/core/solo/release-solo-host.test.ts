import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  blobOf,
  branchOf,
  createSoloRepo,
  git,
  hashWorkingFiles,
  headOf,
  prepareLaneWork,
  readBytes,
  removeFile,
  removeSoloRepo,
  soloBackupDir,
  soloRecordFile,
  soloRefsOf,
  statusOf,
  trackConfigLocalInLane,
  writeFile,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { releaseSoloHost } from './release-solo-host';
import { readSoloState } from './solo-state';

describe('releaseSoloHost', () => {
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

  function expectNoSoloLeftovers(): void {
    expect(fs.existsSync(soloRecordFile(repo.root))).toBe(false);
    expect(fs.existsSync(soloBackupDir(repo.root))).toBe(false);
    expect(soloRefsOf(repo.root)).toEqual([]);
  }

  it('returns a root on a branch byte for byte, ignored files included', async () => {
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();
    expect(hashWorkingFiles(repo.root)).not.toEqual(before);

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result.success).toBe(true);
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(statusOf(repo.root)).toBe('');
    expectNoSoloLeftovers();
    expect((await readSoloState(repo.root)).status).toBe('none');
  });

  it('returns a detached root byte for byte, still detached at the same commit', async () => {
    prepareLaneWork(repo.lane);
    git(repo.root, 'checkout', '-q', '--detach');
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result.success).toBe(true);
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('HEAD');
    expect(statusOf(repo.root)).toBe('');
    expectNoSoloLeftovers();
  });

  it('restores an ignored root file the snapshot overwrote', async () => {
    trackConfigLocalInLane(repo.lane);
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    await acquireLane();
    expect(blobOf(repo.root, 'config.local')).toBe(blobOf(repo.lane, 'config.local'));

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result.success).toBe(true);
    expect(readBytes(repo.root, 'config.local').toString()).toBe('ROOT_SECRET=1\n');
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(statusOf(repo.root)).toBe('');
    expectNoSoloLeftovers();
  });

  it('leaves a file the Solo run created under an ignored path in place', async () => {
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    await acquireLane();
    writeFile(repo.root, 'dist/run-output.js', 'built during solo\n');

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result.success).toBe(true);
    expect(readBytes(repo.root, 'dist/run-output.js').toString()).toBe('built during solo\n');
    const after = hashWorkingFiles(repo.root);
    delete after['dist/run-output.js'];
    expect(after).toEqual(before);
    expect(statusOf(repo.root)).toBe('');
    expectNoSoloLeftovers();
  });

  it('refuses when the root changed during Solo, listing the files, and keeps the hold', async () => {
    prepareLaneWork(repo.lane);
    await acquireLane();
    writeFile(repo.root, 'README.md', '# edited in the root\n');
    writeFile(repo.root, 'scratch.txt', 'new in the root\n');
    removeFile(repo.root, 'src/feature.ts');
    const duringSolo = hashWorkingFiles(repo.root);

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result).toEqual({
      success: false,
      error: { type: 'root_changed', files: ['README.md', 'scratch.txt', 'src/feature.ts'] },
    });
    expect(hashWorkingFiles(repo.root)).toEqual(duringSolo);
    expect((await readSoloState(repo.root)).status).toBe('held');
    expect(soloRefsOf(repo.root)).toEqual(['refs/chord/solo/lane-a']);
  });

  it('discards root changes on request and returns the root byte for byte', async () => {
    prepareLaneWork(repo.lane);
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();
    writeFile(repo.root, 'README.md', '# edited in the root\n');
    writeFile(repo.root, 'scratch.txt', 'new in the root\n');
    removeFile(repo.root, 'src/feature.ts');

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: true });

    expect(result.success).toBe(true);
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(statusOf(repo.root)).toBe('');
    expectNoSoloLeftovers();
  });

  it('refuses when no lane holds the root', async () => {
    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result).toEqual({ success: false, error: { type: 'solo_not_held' } });
  });

  it('does not leave folders the lane added behind', async () => {
    prepareLaneWork(repo.lane);
    await acquireLane();
    expect(fs.existsSync(path.join(repo.root, 'notes'))).toBe(true);

    expect(
      (await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false })).success
    ).toBe(true);

    expect(fs.existsSync(path.join(repo.root, 'notes'))).toBe(false);
  });
});
